"""Responsible for starting up Firefly.

python -m firefly.main

[or]

serviceinit.d/firefly start

Configuration precedence works as follows:
* If a configuration file is specified with -c, --config, that configuration file is loaded
  and takes precedence over other configuration options
* If a supported option is specified via a command line argument, that value is set
* If neither of the above occurs, configuration is read from the default firefly.yaml config
"""

from collections import defaultdict
import logging
from optparse import OptionGroup, OptionParser
import os
import socket
import sys
import util

import tornado.ioloop
import yaml

from firefly.data_server import initialize_data_server
from firefly.ui_server import initialize_ui_server

logging.basicConfig(stream=sys.stdout, level=logging.INFO)
log = logging.getLogger('firefly')


def load_config_from_file(config_file):
    with open(config_file, 'r') as f:
        try:
            config = yaml.safe_load(f)
        except yaml.scanner.ScannerError:
            log.error('Invalid yaml in config file %s' % config_file)
            sys.exit(1)
    return config

if __name__ == "__main__":
    try:
        config = load_config_from_file("firefly.yaml")
    except IOError:
        # If the user doesn't have a local firefly.yaml, let's assume it will be passed with -c
        # (or they will specify all the arguments on the command line...)
        config = {}

    default_data_server_opts = config.get('data_server', {})
    default_ui_server_opts = config.get('ui_server', {})

    parser = OptionParser()
    data_server_group = OptionGroup(parser,
        "Data Server Options",
        "These options control various aspects of the data server, which serves data to the UI server.")
    ui_server_group = OptionGroup(parser,
        "UI Server Options",
        "These options control various aspects of the UI server, which serves the frontend of Firefly.")

    test_mode_help = """\
Runs in test mode:
1. Add a test data server and data source.
2. Making code changes will automatically restart the server."""
    parser.add_option('-c',
        '--config',
        dest='config_file',
        default=None,
        help="Specify a configuration file to read from.")
    parser.add_option('--testing',
        dest='testing',
        action='store_true',
        default=False,
        help=test_mode_help)
    parser.add_option('--no-data-server',
        dest="omit_data_server",
        action="store_true",
        default=config.get('omit_data_server', False),
        help="Disable the data server.")
    parser.add_option('--no-ui-server',
        dest="omit_ui_server",
        action="store_true",
        default=config.get('omit_ui_server', False),
        help="Disable the UI server")

    data_server_group.add_option('--dataserver-port',
        dest='dataserver_port',
        default=default_data_server_opts.get('port', 8890),
        type=int,
        help="The port for the dataserver to listen on")
    data_server_group.add_option('--rrdcached-storage',
        dest='rrdcached_storage',
        default=default_data_server_opts.get('rrdcached_storage', None),
        help='Base directory where rrdcached stores RRD files (skip when --testing)')
    data_server_group.add_option('--rrdcached-socket',
        dest='rrdcached_socket',
        default=default_data_server_opts.get('rrdcached_socket', None),
        help='Path to domain socket rrdcached is listening on (skip when --testing)')
    data_server_group.add_option('--dataserver-db-file',
        dest='dataserver_db_file',
        default=default_data_server_opts.get('db_file', os.path.join('data', 'data_server.sqlite')),
        help='SQLite database file to keep data server information in')

    ui_server_group.add_option('--uiserver-port',
        dest='uiserver_port',
        default=default_ui_server_opts.get('port', 8889),
        help='Port to listen on (default %default)')
    ui_server_group.add_option('--uiserver-db-file',
        dest='uiserver_db_file',
        default=default_ui_server_opts.get('db_file', os.path.join('data', 'ui_server.sqlite')),
        help='SQLite database file to keep UI server information in')
    ui_server_group.add_option('--url-path-prefix',
        dest='url_path_prefix',
        default=default_ui_server_opts.get('url_path_prefix', '/firefly/'),
        help="URL prefix to use")

    parser.add_option_group(data_server_group)
    parser.add_option_group(ui_server_group)

    options, args = parser.parse_args()

    # Make sure we don't get some weird conditions, like disabling
    # both the UI and the data server
    if options.omit_data_server and options.omit_ui_server:
        parser.error("--no-data-server and --no-ui-server both specified!")

    if options.config_file:
        config = load_config_from_file(options.config_file)
    else:
        config = {
            "data_server": {
                "port": options.dataserver_port,
                "rrdcached_storage": options.rrdcached_storage,
                "rrdcached_socket": options.rrdcached_socket,
                "data_sources": config.get("data_server", {}).get("data_sources", []),
                "data_source_config": config.get("data_server", {}).get("data_source_config", defaultdict(dict)),
                "db_file": options.dataserver_db_file
            },
            "ui_server": {
                "port": options.uiserver_port,
                "data_servers": config.get("ui_server", {}).get("data_servers", []),
                "db_file": options.uiserver_db_file,
                "url_path_prefix": options.url_path_prefix
            }
        }

    config["testing"] = options.testing
    config["data_server"]["data_sources_by_key"] = {}

    if options.config_file is None:
        config["config_file"] = "firefly.yaml"
    else:
        config["config_file"] = options.config_file

    if config["testing"]:
        config['data_server']['data_sources'].append('data_sources.test_data.TestData')

        # if we're testing and not behind a reverse proxy (apache), make the base
        # url / instead of /firefly to compensate for apache url rewriting
        config['ui_server']['url_path_prefix'] = '/'

        # Turn on automatic code reloading
        config["data_server"]['debug'] = True
        config["ui_server"]['debug'] = True

        log.info("Running in TEST MODE")

        if "data_servers" not in config['ui_server']:
            config['ui_server']['data_servers'] = []

        if not options.omit_data_server:
            config['ui_server']['data_servers'].append({
                'name': 'http://%s:%s' % (socket.getfqdn(), config["data_server"]["port"]),
                'desc': socket.getfqdn()
            })

    data_sources = []

    # mix in the configured data sources to the data server configuration
    def get_ds_instance(ds):
        ds_class = util.import_module_class(ds)
        ds_kwargs = config['data_server']['data_source_config'].get(ds, {})
        ds_instance = ds_class(**ds_kwargs)  # args only used by StatMonsterRRD atm
        key = util.generate_ds_key(ds)
        ds_instance._FF_KEY = key
        config['data_server']['data_sources_by_key'][key] = ds_instance
        return ds_instance

    for ds in config['data_server']['data_sources']:
        ds_instance = get_ds_instance(ds)
        data_sources.append(ds_instance)
        log.debug('Using datasource %s' % type(ds_instance).__name__)

    config["data_server"]["data_sources"] = data_sources

    if "secret_key" not in config.keys():
        log.error("No Secret Key Provided: Exiting")
        sys.exit(1)

    if not options.omit_data_server:
        # Allow the data server to initialize itself and attach itself to the IOLoop
        try:
            initialize_data_server(config["data_server"], secret_key=config["secret_key"])
        except socket.error as exc:
            log.error('Problem starting data server: %s' % str(exc))
            sys.exit(1)

    if not options.omit_ui_server:
        # Allow the UI server to initialize itself and attach itself to the IOLoop
        try:
            initialize_ui_server(config["ui_server"], secret_key=config["secret_key"])
        except socket.error as exc:
            # The following hack is unfortunate, but necessary.
            # When Tornado forks, its does the right thing when an HTTP server
            # is configured to have as many workers as procs that gets forked.
            # However, if another HTTPServer is on the IOLoop, it will fail to
            # bind to the right address somewhere in the process.
            # This is OK, because the predecessor procs will live on and serve
            # traffic correctly.
            # This has the unfortunate side-effect of masking instances in
            # development when users accidentally try to start multiple
            # instances of Firefly running. The following warning message is
            # intended to provide a hint for this case in development, and can
            # be safely ignored in production.
            if "Address already in use" in str(exc):
                log.warning("UI server socket not bound: %s. This is probably due to multi-processing and can safely be ignored." % str(exc))
                pass
            else:
                log.error('Problem starting ui server: %s' % str(exc))
                sys.exit(1)

    try:
        # Kick everything off
        tornado.ioloop.IOLoop.instance().start()
    except KeyboardInterrupt:
        sys.stderr.write('\nExiting on CTRL-c\n')
        sys.exit(0)
