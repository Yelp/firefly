import colorsys
from datetime import datetime
from urllib2 import urlopen
from urlparse import urljoin

try:
    import json
except ImportError:
    import simplejson as json

import firefly.data_source


class GraphiteHTTP(firefly.data_source.DataSource):
    """
    Stats from graphite-web's HTTP endpoint

    :param graphite_url: Graphite-web URL
    """
    DESC = "GraphiteHTTP"

    def __init__(self, *args, **kwargs):
        super(GraphiteHTTP, self).__init__(*args, **kwargs)
        self.graphite_url = kwargs['graphite_url']

    def list_path(self, path):
        """
        Given a graphite metric name split up into it's segments,
        return a list of the next possible segments.

        :param path: list of path components as strings
        :return: list of dicts containing the path entries
        """
        params = {
            'query' : '.'.join(path + ['*']),
            'format': 'treejson',
        }
        find_url = urljoin(self.graphite_url, 'metrics/find/?%s' % '&'.join(['%s=%s' % (k,v) for k,v in params.items()]))
        find_json = urlopen(find_url).read()
        find_results = json.loads(find_json)

        # Sample input entry from graphite:
        # {
        #     "leaf": 0,
        #     "context": {},
        #     "text": "activemq",
        #     "expandable": 1,
        #     "id": "activemq",
        #     "allowChildren": 1
        # }

        # Sample output entry to firely:
        # {
        #     'type': 'dir',
        #     'name': name,
        #     'children': None
        # }
        contents = list()
        for result in sorted(find_results, key=lambda result: result['text']):
            if result['leaf'] == 0:
                contents.extend(self._form_entries_from_dir(result['text']))
            elif result['leaf'] == 1:
                contents.extend(self._form_entries_from_file(result['text']))
            else:
                raise Exception('Unexpected value for leaf in result: %s' % result)
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
        :param width: ignored
        :return: json string
        """
        # Unfortunately, the most granular unit of time that graphite supports via this API is minute.
        fmt = '%H:%M_%Y%m%d'
        from_str = datetime.fromtimestamp(start).strftime(fmt)
        until_str = datetime.fromtimestamp(end).strftime(fmt)
        output = []

        # TODO: Minimize the number of http calls -- handle multiple sources in a single call
        for metric_segments in sources:
            metric_name = '.'.join(metric_segments)
            params = {
                'target': metric_name,
                'format': 'json',
                'from' : from_str,
                'until': until_str,
            }
            render_url = urljoin(self.graphite_url, 'render/?%s' % '&'.join(['%s=%s' % (k,v) for k,v in params.items()]))
            render_json = urlopen(render_url).read()
            render_results = json.loads(render_json)

            for result in render_results:
                datapoints = result['datapoints']
                for datapoint in datapoints:
                    output_datapoint = {
                        't': datapoint[1],
                        'v': [datapoint[0]]
                    }
                    output.append(output_datapoint)

        return json.dumps(output)

    def legend(self, sources):
        return self._svc(sources)

    def title(self, sources):
        return ["graphite_http"]
