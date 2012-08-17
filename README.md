# ![Firefly logo](https://raw.github.com/Yelp/firefly/master/docs/firefly-small.png) Firefly

Firefly is a web application aimed at powerful, flexible time series graphing for web developers.

Firefly provides an interface for reading time series data from any number of server-side data stores and produces corresponding real-time graphs in a web browser. Multiple metrics can combine into a single graph, and graphs combine together in grids to form a Dashboard - which you can use to get a high-level view of your services.

The current release ships with a DataSource that reads RRD files - specifically, those produced by Ganglia.  However it's simple to expand to other sources, from an in-house relational database to a cross-network API.

## Features

* Line, stacked, and area graphs
* Configure graphs with arbitrary numbers of data sources
* Configure grids of graphs -- great for creating dashboards of related information
* View graphs from multiple datacenters in the same dashboard
* Show historical overlays along with your real-time data
* Log-scale Y-axis
* Support for isolated and embedded graphs
* Native API support for annotations

## Prerequisites

Firefly is written in Python and requires Python 2.6 or greater.

### YAML

Firefly's configuration is formatted entirely as YAML. YAML is pretty easy to pick up, but you'll still want to be familiar with the [YAML Spec](http://www.yaml.org/spec/1.2/spec.html) if you are not already.

### Data Sources

The core of Firefly is the abstract concept of a DataSource. A DataSource just needs to expose a certain interface (methods to list available metrics, and get the data for a particular metric between particular timestamps) - beyond that, the system is datastore-agnostic and should be widely expandable.  We've included a DataSource for parsing Ganglia RRD files out of the box.  But Firefly is not just a front-end for Ganglia, and in time we'll be looking to release more of the metrics gathering tools we use behind Firefly.

For Ganglia support, the [rrdcached integration wiki page](http://sourceforge.net/apps/trac/ganglia/wiki/rrdcached_integration) might be of use, as Firefly will work best if it speaks to `rrdcached` to protect your hard disks from getting hammered.

## Getting Started

To get up and running immediately, make sure you update your submodules: `git submodule update --init`. Then simply run `python -m firefly.main --testing -c firefly.yaml.example` from your Firefly checkout.

For more help: `python -m firefly.main --help` or take a peek in `firefly.yaml.example`

_**Note:** Some configuration options can only be specified in your YAML configuration file._

## Deploying

### How Firefly Runs in Production

Firefly is divided into two parts: a **data server** and a **UI server**. How you deploy these parts of Firefly will depend on how your existing deployments are structured.

The UI server is a thin wrapper that mostly serves static content, so you'll likely only run one of them.  The data server will be run wherever you need a local process to access stored metrics.  For instance, if you have Ganglia's RRD files stored on a single server in each of two datacenters, you'd want to run data servers on those same machines.  The UI server can be configured to know about both data servers, and the whole system will work from a unified interface.  Additionally, the UI server can be behind HTTP Basic Auth, and will use a mildly secure short-lived token to talk to the data servers - a necessity, since browsers don't elegantly support Basic Auth dialogs when doing CORS AJAX requests.

### Setting Up the Data Servers

In your data server configuration files, you will want to specify `omit_ui_server: true`. This will instruct Firefly to **only start a data server** and _not_ a UI server. You will also want to be sure that the RRD socket and storage locations are set appropriately for any data sources you configure, including Ganglia.  You may also wish to change the port of the data server if you are running it behind a reverse proxy.

### Setting Up the UI Server

You will need to specify each data server you set up in the `data_servers` section of the `ui_server` configuration section. Data servers are specified by the URL they can be reached at in the `name` attribute and a description of the data server's environment in the `desc` attribute.

If you are hosting Firefly on the same machine as other web services or running behind a reverse proxy, you might want to set `url_path_prefix` and `port` to your desired values. By default Firefly runs with a url prefix of `/firefly/` when not in `--testing` mode.

### Starting Your Firefly Servers

Simply start each Firefly instance you have in your various environments with the appropriate configuration files:

`python -m firefly.main -c <configuration file>`


## Developing

First, give yourself a base YAML configuration file. `cp firefly.yaml.example firefly.yaml`. Firefly reads from firefly.yaml first and then overrides the values specified in this file with any command line options specified. This is allows you to flip various switches during development which you can then set later in your production config (configuration files specified with `-c` will always override other command line options).

There are a few configuration options you'll want to fill in before you can start graphing. Firefly is divided into two parts: a **data server** and a **ui server**, each of which has its own set of configuration options. Below are the various options you'll want to set to get started from a fresh checkout.

### Data Server Configuration

If you have an accessible Ganglia instance running, you should set the location of the Ganglia RRD socket and storage in the `rrdcached_socket` and `rrdcached_storage` settings of `data_sources.ganglia_rrd.GangliaRRD`:

	data_source_config:
		data_sources.ganglia_rrd.GangliaRRD:
			rrdcached_socket: "/path/to/your/ganglia/rrd/unix/domain/socket.sock"
			rrdcached_storage: "/path/to/your/ganglia/rrd/storage"

If you do not have Ganglia running, comment out this data source in the `data_sources` section:

	data_sources:
		# - data_sources.ganglia_rrd.GangliaRRD
		- data_sources.stat_monster_rrd.StatMonsterRRD

If you want to run with any additional custom data sources, add them to the `data_sources` section and provide the kwargs they will be passed in the `data_source_config` section.

### Running Firefly

`python -m firefly.main --testing`

This starts both a data server and a UI server in the same web server running on the local machine. The UI server is accessible on `localhost:8889` by default. Note that you do not need to have any data servers configured in the UI server for the UI server to know about the local data server running alongside it!

Firefly will also give you a test data source to use, which will produce a constant sine wave across all time periods.

## Miscellaneous Configuration

### Annotations

Firefly supports annotating graphs with various events that you might be interested in. To add annotations simply send an HTTP `POST` request to the `/add_annotation` endpoint on each of your data servers that the annotation applies to. This endpoint expects four arguments in the `POST` body:

* `token` - A token obtained from the UI server (`GET http://ui_server/token`).
* `type` - Specifies the type of annotation. Should be a single word with alphanumeric characters only. This is the text displayed on the graphs next to the annotation marker.
* `description` - A description of the event this annotation is for.
* `time` - The time the annotation occurred, as a floating point number of seconds since the epoch.

### Database Files

You can control where the data server and UI server put their SQLite database files with the `db_file` configuration variable, which can be set for both `data_server` and `ui_server`.
