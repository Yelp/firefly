from datetime import datetime
from datetime import timedelta
from itertools import izip
from urlparse import urljoin

import requests

try:
    import simplejson as json
except ImportError:
    import json

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
        self.resolution = kwargs['resolution']
        self.offset = 100
    
    def list_path(self, path):
        query = '.'.join(path + ['*'])
        metric_name = query.split('*')[0]

        contents = list()

        # Each metric in Librato has a number of sources, as opposed to Firefly where everything is a source
        # In the case that there is a metric name in the path, get its sources
        if metric_name:
            params = {
                'start_time': (datetime.now() - timedelta(hours=1)).strftime('%s'),
                'resolution': self.resolution
            }
           
            find_url = self._build_librato_metrics_url(metric_name[:-1], params)

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

                offset += self.offset

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

        params = {
            'start_time': start,
            'end_time': end,
            'resolution': self.resolution
        }

        metric_name = sources[0][0]
        source = sources[0][1]
       
        render_url = self._build_librato_metrics_url(metric_name, params)

        r = requests.get(render_url, auth=(self.username, self.password))
        render_results = r.json()
           
        out = []

        for result in render_results['measurements']:
            # Librato shortens really long source names with a '..'
            # So, we check if either the source name matches or the beginning and end of the shortened source name are substrings
            if (source == result) or all(substr in result for substr in source.split('..')):
                for datapoint in render_results['measurements'][source]:
                    point = {}
                    point['t'] = datapoint['measure_time']
                    point['v'] = [datapoint['value']]
                    out.append(point)
                break
        
        return json.dumps(out)
        
    def _build_librato_metrics_url(self, metric_name, params):
        url_params = 'v1/metrics/' + metric_name + '?'
        url_params += '&'.join(['%s=%s' % (k, v) for k, v in params.items()])
        return urljoin(self.librato_url, url_params)

    def legend(self, sources):
        return self._svc(sources)

    def title(self, sources):
        return ["librato"]
