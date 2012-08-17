from __future__ import with_statement

import logging
import os.path


import util

import tornado.httpserver
import tornado.ioloop
import tornado.web




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


    """Stores state data and returns an ID for later retrieval"""

    def post(self):
        conn = self.application.settings['db_connection']
        state = unicode(self.request.body, 'utf_8')
        state_hash = buffer(hashlib.sha1(state.encode('utf_8')).digest())
        row = conn.execute("select id from states where state_hash=?", (state_hash,)).fetchone()
        stateid = row[0] if row else conn.execute("insert into states(state, state_hash) values (?, ?)", (state, state_hash)).lastrowid

        self.set_header("Content-Type", "text/plain")
        self.write(util.b58encode(stateid))


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


def initialize_ui_server(config, secret_key=None, ioloop=None):
    if not ioloop:
        ioloop = tornado.ioloop.IOLoop.instance()

    # connect to the database
    conn = sqlite3.connect(config['db_file'], isolation_level=None)
    conn.execute("create table if not exists states (id integer primary key autoincrement, state text not null, state_hash blob not null)")
    conn.execute("create index if not exists hash_idx on states(state_hash)")

    config["static_path"] = os.path.join(os.path.join(*os.path.split(__file__)[:-1]), 'static')
    config["db_connection"] = conn
    config["static_url_prefix"] = os.path.join(config["url_path_prefix"], "static") + "/"
    config["secret_key"] = secret_key

    # init the application instance
    application = tornado.web.Application([
        (r"/", IndexHandler),
        (r"/token", TokenHandler),
        (r"/shorten", ShortenHandler),
        (r"/expand/(.*)", ExpandHandler),
        (r"/static/(.*)", tornado.web.StaticFileHandler, {"path": config['static_path']}),
    ], **config)

    # start the main server
    http_server = tornado.httpserver.HTTPServer(application, io_loop=ioloop)
    http_server.listen(config["port"])

    log.info('Firefly UI server started on port %d' % config["port"])
