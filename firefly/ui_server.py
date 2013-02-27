from __future__ import with_statement

import re
import sys
import hashlib
import logging
import os.path
import sqlite3

try:
    import json
except ImportError:
    import simplejson as json

import tornado.web
import tornado.ioloop
import tornado.httpserver

import util

logging.basicConfig(stream=sys.stdout, level=logging.INFO)
log = logging.getLogger('firefly_ui_server')


def shorten(state, db_conn):
    """Returns the b58encoded id of the provided full firefly
    state description. Creates a new entry for state if one
    doesn't already exist in the db.
    """
    state = unicode(state, 'utf_8')
    state_hash = buffer(hashlib.sha1(state.encode('utf_8')).digest())
    row = db_conn.execute("select id from states where state_hash=?", (state_hash,)).fetchone()
    stateid = row[0] if row else db_conn.execute("insert into states(state, state_hash) values (?, ?)", (state, state_hash)).lastrowid
    return util.b58encode(stateid)


class IndexHandler(tornado.web.RequestHandler):
    """Serves the basic dashboard page"""

    def get(self):
        """Handle the default case of just hitting the index."""
        embed = False
        if self.get_argument('embed', '') == 'true':
            embed = True
        env = {
            'url_path_prefix': self.application.settings['url_path_prefix'],
            'data_servers': self.application.settings['data_servers'],
            'embedded': embed}

        self.render("templates/index.html", **env)

class TokenHandler(tornado.web.RequestHandler):
    """Generate tokens"""

    def get(self):
        self.set_header("Content-Type", "text/plain")
        self.write(util.generate_access_token(self.application.settings['secret_key']))

class ShortenHandler(tornado.web.RequestHandler):
    """Stores state data and returns an ID for later retrieval"""

    def post(self):
        conn = self.application.settings['db_connection']
        stateid = shorten(self.request.body, conn)
        self.set_header("Content-Type", "text/plain")
        self.write(stateid)

class ExpandHandler(tornado.web.RequestHandler):
    """Retrieves state data given an ID"""

    def get(self, b58id):
        conn = self.application.settings['db_connection']
        try:
            stateid = util.b58decode(b58id)
        except:
            raise tornado.web.HTTPError(404)
        row = conn.execute("select state from states where id=?", (stateid,)).fetchone()

        if row:
            self.set_header("Content-Type", "application/json; charset=UTF-8")
            self.write(row[0])
        else:
            raise tornado.web.HTTPError(404)

class RedirectHandler(tornado.web.RequestHandler):
    """Redirects to graph display given a full state description.
    Useful for embedding graphs to show programatically supplied values.
    """

    def get(self, serialized):
        fragment = shorten(serialized, self.application.settings['db_connection'])
        url = self.application.settings['url_path_prefix']
        if self.get_argument('embed', '') == 'true':
            url += "?embed=true"
        self.redirect(url + '#!' + fragment)

class NameHandler(tornado.web.RequestHandler):
    """Handles storing and retrieving named dashboards"""

    def put(self, name):
        if not name:
            self.set_status(500)
            self.write('Name cannot be empty');
            return
        name = re.sub('\s', '-', name)
        conn = self.application.settings['db_connection']
        req = json.loads(self.request.body)
        b58id = req['frag'].lstrip('#!')
        stateid = util.b58decode(b58id)
        if not req['confirmed']:
            exists = conn.execute("select * from names where name = ?", (name,)).fetchone()
            if exists:
                self.set_status(409)
                self.write('This name is already stored.  Are you sure you want to overwrite it?')
                return

        conn.execute("insert or replace into names (name, stateid) values (?, ?)", (name, stateid))
        url = self.application.settings['url_path_prefix']
        self.write('%snamed/%s' % (url, name))
        return

    def get(self, name):
        conn = self.application.settings['db_connection']
        stateid = conn.execute("select stateid from names where name = ?", (name,)).fetchone()

        if stateid:
            b58id = util.b58encode(stateid[0])
            url = self.application.settings['url_path_prefix']
            self.redirect('%s?incoming=%s#!%s' % (url, name, b58id))
        else:
            self.redirect('/')


class DashboardListHandler(tornado.web.RequestHandler):
    """Displays a list of dashboards that have been saved using the
    functionality in NameHandler.
    """

    def get(self):
        conn = self.application.settings['db_connection']

        names = conn.execute("SELECT name FROM names ORDER BY name ASC").fetchall()

        # names comes back in the form of a list of tuples
        # we only need a list of names, so let's flatten this
        names = [name[0] for name in names]

        env = {
            'url_path_prefix': self.application.settings['url_path_prefix'],
            'names': names
        }

        self.render("templates/list_dashboards.html", **env)


def initialize_ui_server(config, secret_key=None, ioloop=None):
    if not ioloop:
        ioloop = tornado.ioloop.IOLoop.instance()

    # connect to the database
    conn = sqlite3.connect(config['db_file'], isolation_level=None)
    conn.execute("create table if not exists states (id integer primary key autoincrement, state text not null, state_hash blob not null)")
    conn.execute("create index if not exists hash_idx on states(state_hash)")
    conn.execute("create table if not exists names (id integer primary key autoincrement, name text not null, stateid integer not null)")
    conn.execute("create unique index if not exists name_idx on names (name)")

    config["static_path"] = os.path.join(os.path.join(*os.path.split(__file__)[:-1]), 'static')
    config["db_connection"] = conn
    config["static_url_prefix"] = os.path.join(config["url_path_prefix"], "static") + "/"
    config["secret_key"] = secret_key
    config['autoescape'] = None

    # init the application instance
    application = tornado.web.Application([
        (r"/", IndexHandler),
        (r"/token", TokenHandler),
        (r"/shorten", ShortenHandler),
        (r"/expand/(.*)", ExpandHandler),
        (r"/redirect/(.*)", RedirectHandler),
        (r"/named/(.*)", NameHandler),
        (r"/dashboards", DashboardListHandler),
        (r"/static/(.*)", tornado.web.StaticFileHandler, {"path": config['static_path']}),
    ], **config)

    # start the main server
    http_server = tornado.httpserver.HTTPServer(application, io_loop=ioloop)
    http_server.listen(config["port"])

    log.info('Firefly UI server started on port %d' % config["port"])
