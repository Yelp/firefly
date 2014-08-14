from datetime import datetime, timedelta
from urllib2 import urlopen, Request
from itertools import izip
from urlparse import urljoin

import base64
import requests

try:
    import json
except ImportError:
    import simplejson as json

import firefly.data_source

class Librato(firefly.data_source.DataSource):
    """
    Stats from the Librato API
    """

    DESC = "Librato"

    def __init__(self, *args, **kwargs):
        super(Librato, self).__init__(*args, **kwargs)
        self.librato_url = kwargs['librato_url']
        self.username = kwargs['username']
        self.password = kwargs['password']

    def list_path(self, path):
        query = '.'.join(path + ['*'])
        metric_name = query.split('*')[0]

        contents = list()

        # Each metric in Librato has a number of sources, as opposed to Firefly where everything is a source
        # In the case that there is a metric name in the path, get its sources
        if metric_name:
            params = {
                'start_time': (datetime.now() - timedelta(hours=1)).strftime('%s'),
                'resolution': 60
            }
            
            fmt = '%Y-%m-%d %H:%M:%S'
            from_str = datetime.fromtimestamp(float(params['start_time'])).strftime(fmt)

            find_url = urljoin(self.librato_url, 'v1/metrics/' + metric_name[:-1] + '?' + '&'.join(['%s=%s' % (k, v) for k, v in params.items()]))
            r = requests.get(find_url, auth=(self.username, self.password))
            find_results = r.json()

            for measurement in find_results['measurements']:
                contents.extend(self._form_entries_from_file(measurement))

        # Otherwise, get all the metrics
        else:
            offset = 0
            metrics_remaining = True

            # Librato can only send a 100 metrics at a time, so multiple requests are required to get all the metrics
            while metrics_remaining:

                find_url = urljoin(self.librato_url, 'v1/metrics?name=' + query + '&offset=' + str(offset))

                r = requests.get(find_url, auth=(self.username, self.password))
                find_results = r.json()

                offset += 100

                if find_results['metrics']:
                    for metric in find_results['metrics']:
                        contents.extend(self._form_entries_from_dir(metric['name'])) 
                else:
                    metrics_remaining = False

        return contents

    def _form_entries_from_dir(self, name):
        return [{'type': 'dir', 'name': name, 'children': None}]

    def _form_entries_from_file(self, name):
        return [{'type': 'file', 'name': name}]

    def data(self, sources, start, end, width):

        serieses = []
        step = None

        fmt = '%Y-%m-%d %H:%M:%S'
        from_str = datetime.fromtimestamp(start).strftime(fmt)

        params = {
            'start_time': start,
            'end_time': end,
            'resolution': 60
        }

        metric_name = sources[0][0]
        source = sources[0][1]

        
        render_url = urljoin(self.librato_url, 'v1/metrics/' + metric_name + '?' + '&'.join(['%s=%s' % (k, v) for k, v in params.items()]))

        r = requests.get(render_url, auth=(self.username, self.password))
        render_results = r.json()
           
        out = []

        for result in render_results['measurements']:
            # Librato shorterns really long source names with a '..'
            # So, we check if either the source name matches or the shortened source name is a substring
            source_substrings = source.split('..')
            if (source == result) or (source_substrings[0] in result and source_substrings[1] in result):
                for datapoint in render_results['measurements'][source]:
                    out.append({'t': datapoint['measure_time'], 'v': [datapoint['value']]})
                break
        
        return json.dumps(out)

    def legend(self, sources):
        return self._svc(sources)

    def title(self, sources):
        return ["librato"]

