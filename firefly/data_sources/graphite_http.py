import os
import os.path
import colorsys
from itertools import izip
from urlparse import urljoin
import urllib2
from datetime import datetime

try:
    import json
except ImportError:
    import simplejson as json

import firefly.data_source


class GraphiteHTTP(firefly.data_source.DataSource):
    """Stats from graphite-web's HTTP endpoint"""

    DESC = "GraphiteHTTP"

    def __init__(self, *args, **kwargs):
        super(GraphiteHTTP, self).__init__(*args, **kwargs)
        self.graphite_url = kwargs['graphite_url']
        self.logger.warn('GraphiteHTTP reloaded!')

    def list_path(self, path):
        """
        Given a graphite metric name split up into it's segments,
        return a list of the next possible segments.

        :param path: array of path components
        :type path: list of strings

        :return: list of dicts containing the entries
        :rtype: list
        """

        # GET /metrics/find/?_dc=1390978202290&query=*&format=treejson&contexts=1&path=&node=GraphiteTree HTTP/1.1
        # Host: graphite.yelpcorp.com
        # User-Agent: Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:26.0) Gecko/20100101 Firefox/26.0
        # Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
        # Accept-Language: en-US,en;q=0.5
        # Accept-Encoding: gzip, deflate
        # X-Requested-With: XMLHttpRequest
        # Referer: https://graphite.yelpcorp.com/composer/?
        # Authorization: Basic c3BhdGVsOmVhdHNoMXRsZW5ueQ==
        # Connection: keep-alive

        # Document the /metrics/find URI
        #  format = treejson | completer | pickle - defaults to treejson
        #
        #  format = request.REQUEST.get('format', 'treejson')
        #  local_only = int( request.REQUEST.get('local', 0) )
        #  wildcards = int( request.REQUEST.get('wildcards', 0) )
        #  fromTime = int( request.REQUEST.get('from', -1) )
        #  untilTime = int( request.REQUEST.get('until', -1) )
        #  automatic_variants = int( request.REQUEST.get('automatic_variants', 0) )
        #
        #  path - doesn't look like it is used
        #  node - doesn't look like it is used
        #  contexts - doesn't look like it is used

        # Querying root:
        #   query = *
        #   format = treejson
        #   local = 0
        #   wildcards = 0
        #   path =
        #   node = GraphiteTree
        #   contexts = 1

        # Querying prod node
        #   GET /metrics/find/?_dc=1390978365145&query=prod.*&format=treejson&contexts=1&path=prod&node=prod HTTP/1.1
        #
        #   query = prod.*
        #   format = treejson
        #   path = prod
        #   node = prod

        param = {
            'query' : '.'.join(path + ['*']),
            'format': 'treejson'
        }
        find_url = urljoin(self.graphite_url, 'metrics/find/?%s' % '&'.join(['%s=%s' % (k,v) for k,v in param.items()]))
        find_json = urllib2.urlopen(find_url).read()
        self.logger.warn('find_url %s' % find_url)
        self.logger.warn('find_json %s' % find_json)

        find_results = json.loads(find_json)

        contents = list()
        for result in find_results:
            if result['leaf'] == 0:
                contents.extend(self._form_entries_from_dir(result['text']))
            elif result['leaf'] == 1:
                contents.extend(self._form_entries_from_file(result['text']))
            else:
                raise Exception('Unexpected value for leaf in result: %s' % result)

        # FROM:
        # {
        #     "leaf": 0,
        #     "context": {},
        #     "text": "activemq",
        #     "expandable": 1,
        #     "id": "activemq",
        #     "allowChildren": 1
        # }

        # TO
        #return [{'type': 'dir', 'name': name, 'children': None}]

        # contents = []
        # root = self.GRAPH_ROOT if not path else os.path.join(self.GRAPH_ROOT, os.path.join(*path))
        # for name in sorted(os.listdir(root)):
        #     if os.path.isdir(os.path.join(root, name)):
        #         entries = self._form_entries_from_dir(root, name)
        #         if entries:
        #             contents.extend(entries)
        #     else:
        #         entries = self._form_entries_from_file(root, name)
        #         if entries:
        #             contents.extend(entries)
        # self.logger.warn('list_path:%s:%s' % (path, contents))
        # return contents
        return contents

    def _form_entries_from_dir(self, name):
        return [{'type': 'dir', 'name': name, 'children': None}]

    def _form_entries_from_file(self, name):
        return [{'type': 'file', 'name': name}]

    def _svc(self, sources):
        colorstep = 1.0 / len(sources)
        svc = zip(sources, ("#%s" % ("%02x%02x%02x" % colorsys.hsv_to_rgb(i*colorstep, 1, 255)) for i in xrange(len(sources))))
        return svc

    def data(self, sources, start, end, width):
        """
        :param sources: list of list of path segments
        :param start: timestamp like 1391044540
        :param end: timestamp like 1391048200
        :param width: ignore for graphite
        """
        self.logger.warn('sources %s  start %s  end %s  width %s' % (sources, start, end, width))
        # HH:MM_YYMMDD
        fmt = '%H:%M_%Y%m%d'
        from_str = datetime.fromtimestamp(start).strftime(fmt)
        until_str = datetime.fromtimestamp(end).strftime(fmt)
        output = []

        for metric_segments in sources:
            metric_name = '.'.join(metric_segments)

            params = {
                'target': metric_name,
                'format': 'json',
                'from' : from_str,
                'until': until_str,
            }

            # http://graphite/render?target=app.numUsers&format=json
            render_url = urljoin(self.graphite_url, 'render/?%s' % '&'.join(['%s=%s' % (k,v) for k,v in params.items()]))
            self.logger.warn('render_url %s' % render_url)
            render_json = urllib2.urlopen(render_url).read()
            self.logger.warn('render_json %s' % render_json)
            render_results = json.loads(render_json)


            for result in render_results:
                datapoints = result['datapoints']
                for datapoint in datapoints:
                    output_datapoint = {
                        't': datapoint[1],
                        'v': [datapoint[0]]
                    }
                    output.append(output_datapoint)

        output_str = json.dumps(output, indent=2)
        return output_str
         # [
         #     {
         #            "target": "devc.addelivery.uswest1cdevc.elb.RequestCount",
         #            "datapoints": [
         #                [2.0, 1391047920],
         #                [6.0, 1391047980],
         #                [9.0, 1391048040],
         #                [12.0, 1391048100],
         #                [11.0, 1391048160],
         #                [9.0, 1391048220],
         #                [8.0, 1391048280],
         #                [5.0, 1391048340], [9.0, 1391048400], [14.0, 1391048460], [9.0, 1391048520], [12.0, 1391048580], [8.0, 1391048640], [7.0, 1391048700], [8.0, 1391048760], [4.0, 1391048820], [6.0, 1391048880], [3.0, 1391048940], [4.0, 1391049000], [4.0, 1391049060], [1.0, 1391049120], [2.0, 1391049180], [4.0, 1391049240], [3.0, 1391049300], [1.0, 1391049360], [4.0, 1391049420], [1.0, 1391049480], [4.0, 1391049540], [2.0, 1391049600], [2.0, 1391049660], [2.0, 1391049720], [4.0, 1391049780], [4.0, 1391049840], [3.0, 1391049900], [4.0, 1391049960], [6.0, 1391050020], [2.0, 1391050080], [2.0, 1391050140], [2.0, 1391050200], [1.0, 1391050260], [3.0, 1391050320], [3.0, 1391050380], [1.0, 1391050440], [2.0, 1391050500], [2.0, 1391050560], [2.0, 1391050620], [null, 1391050680], [4.0, 1391050740], [13.0, 1391050800], [null, 1391050860], [1.0, 1391050920], [null, 1391050980], [6.0, 1391051040], [9.0, 1391051100], [null, 1391051160], [null, 1391051220], [2.0, 1391051280], [3.0, 1391051340], [5.0, 1391051400], [8.0, 1391051460],
         #                [null, 1391051520]
         #            ]
         #     }
         # ]


          # {
          #   "t": 1391047740,
          #   "v": [
          #     6.0
          #   ]
          # },

        # serieses = []
        # for source in sources:
        #     path = os.path.join(self.GRAPH_ROOT, "%s.wsp" % (os.path.join(*source),))
        #     timeInfo, values = whisper.fetch(path, start, end)
        #     print len(values)
        #     start, end, step = timeInfo
        #     serieses.append(values)
        #
        # out = []
        # for timestamp, values in izip(xrange(start, end, step), izip(*serieses)):
        #     out.append({'t': timestamp, 'v': [v for v in values]})
        #return json.dumps(out)
        #return "[]"

    def legend(self, sources):
        return self._svc(sources)

    def title(self, sources):
        return ["graphite"]
