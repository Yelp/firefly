from __future__ import with_statement

import os
import re
import sys
import time
import signal
import socket
import sqlite3
import hashlib
import logging
import datetime

try:
    import json
except ImportError:
    import simplejson as json


import yaml
import tornado.web
import tornado.ioloop
import tornado.httpclient
import tornado.httpserver

import util

log = logging.getLogger('firefly_data_server')

DEFAULT_DATA_SERVER_PORT = 8890

# The number of annotations to draw before we stop
# This cut-off exists because browsers are unhappy with a lot of these
ANNOTATIONS_CUT_OFF = 300

def token_authed(method):
    def new_method(self):
        token = self.get_argument('token')
        if not util.verify_access_token(token, self.application.settings['secret_key']):
            raise tornado.web.HTTPError(403)
        method(self)
    return new_method

class SourcesHandler(tornado.web.RequestHandler):
    @token_authed
    def get(self):
        path = json.loads(self.get_argument('path'))

        if not path:
            contents = self._list_sourcelists()
        else:
            ds = self.application.settings['data_sources_by_key'][path[0]]
            contents = ds.list_path(path[1:])

        self.set_header("Content-Type", "application/json")
        self.set_header("Cache-Control", "no-cache, must-revalidate")
        self.set_header("Access-Control-Allow-Origin", "*")
        self.write(json.dumps(contents))

    def _list_sourcelists(self):
        data_sources = self.application.settings['data_sources']

        sourcelists = [{
            'name': src._FF_KEY,
            'type': 'data_source',
            'desc': src.DESC,
            'children': None} for src in data_sources if not src.ui_exclude]
        return sourcelists


class GraphBaseHandler(tornado.web.RequestHandler):
    """Base class implementing common ops"""

    def get_params(self):
        sources = self.get_argument('sources', '')
        if sources != '':
            sources = json.loads(sources)
        start = int(self.get_argument('start', 0))
        end = int(self.get_argument('end', 0))
        zoom = int(self.get_argument('zoom', 0))
        width = int(self.get_argument('width', 0))
        height = int(self.get_argument('height', 0))
        y_axis_log_scale = self.get_argument('y_axis_log_scale', False)
        y_axis_origin_zero = self.get_argument('y_axis_origin_zero', False)
        overlay_previous_period = self.get_argument('overlay_previous_period', False)
        stacked_graph = self.get_argument('stacked_graph', False)
        area_graph = self.get_argument('area_graph', False)
        if sources:
            data_source, sources = parse_sources(sources, self.application.settings['data_sources_by_key'])
        else:
            data_source = None

        return {
            'data_source': data_source,
            'sources': sources,
            'start': start,
            'end': end,
            'width': width,
            'height': height,
            'options': {
                'zoom': zoom,
                'y_axis_log_scale': y_axis_log_scale,
                'y_axis_origin_zero': y_axis_origin_zero,
                'overlay_previous_period': overlay_previous_period,
                'stacked_graph': stacked_graph,
                'area_graph': area_graph}}


class DataHandler(GraphBaseHandler):
    """Handler for json graph data"""

    @token_authed
    def get(self):
        params = self.get_params()
        data = params['data_source'].data(
            params['sources'],
            params['start'],
            params['end'],
            params['width'])

        self.set_header("Content-Type", 'application/json')
        self.set_header("Cache-Control", "no-cache, must-revalidate")
        self.set_header("Access-Control-Allow-Origin", "*")
        self.write(data)


class GraphLegendHandler(GraphBaseHandler):
    """Handler for the legend data for a given graph"""

    @token_authed
    def get(self):
        params = self.get_params()
        svc = params['data_source'].legend(params['sources'])

        self.set_header('Content-Type', 'application/json')
        self.set_header("Cache-Control", "no-cache, must-revalidate")
        self.set_header("Access-Control-Allow-Origin", "*")
        self.write(json.dumps({'legend': svc}))


class GraphTitleHandler(GraphBaseHandler):
    """Handler for the title data for a given graph"""

    @token_authed
    def get(self):
        params = self.get_params()
        title = params['data_source'].title(params['sources'])

        self.set_header('Content-Type', 'application/json')
        self.set_header("Cache-Control", "no-cache, must-revalidate")
        self.set_header("Access-Control-Allow-Origin", "*")
        self.write(json.dumps({'title': title}))

class AnnotationsHandler(GraphBaseHandler):
    """Handler to provide annotations data for a graph"""

    @token_authed
    def get(self):
        params = self.get_params()

        cursor = self.settings["db"].cursor()

        annotations_rows = cursor.execute('SELECT type, description, time, id FROM annotations WHERE time >= ? and time <= ? ORDER BY time DESC LIMIT ?',
                                          (params['start'], params['end'], ANNOTATIONS_CUT_OFF))

        self.set_header('Content-Type', 'application/json')
        self.set_header("Cache-Control", "no-cache, must-revalidate")
        self.set_header("Access-Control-Allow-Origin", "*")

        keys = [desc[0] for desc in cursor.description]
        # This funky comprehension(s) associates a key with each value in each row
        # giving us a nice list of dicts instead of just a list of tuples
        # should help debugging and clarity on the javascript side
        annotations = [dict((key, value) for key, value in zip(keys, row)) for row in cursor]

        cursor.close()

        self.write(json.dumps(annotations))

class AddAnnotationHandler(tornado.web.RequestHandler):
    """Handler to take POSTs to add annotations to the database."""

    TYPE_RE = re.compile('^[A-Za-z0-9]+$')
    DESCRIPTION_RE = re.compile('^[A-Za-z0-9 \(\)\'\-]+$')

    @token_authed
    def post(self):
        """Given a type, a description, and a time, insert an annotation into the annotations database.

        Params:
            type: A string describing the type of annotation this is
            description: A string with additional details about the event that this annotation represents
            time: An floating-point number of seconds representing the time at which the event occurred.
        """
        an_type, an_desc, an_time = ((self.get_argument(param) for param in ('type', 'description', 'time')))
        an_time = float(an_time)
        if not self.TYPE_RE.match(an_type):
            raise tornado.httpclient.HTTPError(400, "Invalid annotation type specified.")
        if not self.DESCRIPTION_RE.match(an_desc):
            raise tornado.httpclient.HTTPError(400, "Invalid annotation description specified.")

        # Insert this annotation into the DB
        # Note that SQLite takes care of the sanitation here for us, so this isn't quite as scary as it looks
        self.settings['db'].execute("INSERT INTO annotations (type, description, time) VALUES (?,?,?)", (an_type, an_desc, an_time))

        # It's comforting to know things went alright
        self.write(json.dumps({"status": "ok"}))

class PingHandler(GraphBaseHandler):
    """Handler for monitoring"""

    def get(self):
        self.write('pong\n')


def parse_sources(sources, data_sources_by_key):
    data_source_name = sources[0][0]
    ds = data_sources_by_key[data_source_name]
    srcs = [source[1:] for source in sources]
    return ds, srcs


def initialize_data_server(config_global, secret_key=None):
    config = config_global["data_server"]

    # connect to the database to store annotation in
    # I kind of hate having the schema for this DB here, but I'm going to leave it for to retain parity with ui_server.py
    db_conn = sqlite3.connect(config['db_file'], isolation_level=None)
    db_conn.execute("""
        create table if not exists annotations (
            id integer primary key autoincrement,
            type integer not null,
            description text not null,
            time float not null
        )""")
    db_conn.execute("create index if not exists time on annotations(time)")

    config['db'] = db_conn
    config["secret_key"] = secret_key

    # init the application instance
    application = tornado.web.Application([
        (r"/data", DataHandler),
        (r"/legend", GraphLegendHandler),
        (r"/title", GraphTitleHandler),
        (r"/ping", PingHandler),
        (r"/annotations", AnnotationsHandler),
        (r"/add_annotation", AddAnnotationHandler),
        (r"/sources", SourcesHandler)], **config)

    # start the main server
    http_server = tornado.httpserver.HTTPServer(application)
    http_server.bind(config["port"])
    http_server.start(0)

    # setup logging
    util.setup_logging(config_global)

    log.info('Firefly data server started on port %d' % config["port"])
