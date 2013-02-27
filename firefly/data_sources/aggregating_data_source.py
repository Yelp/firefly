# -*- coding: utf-8 -*-
"""Contains a data source designed to aggregate other data sources.

This data source is essentially a wrapper data source that allows one to run
several Firefly data servers in a given environment to form a single 'logical'
data server. This data source just speaks the Firefly data protocol to the
other data servers to collect data.
"""
from collections import defaultdict
import json
from urllib import urlencode
from urllib2 import urlopen
from urllib2 import URLError

from firefly import util
import firefly.data_source


class AggregatingDataSource(firefly.data_source.DataSource):
    """Aggregates one or more other data servers into a single logical data
    source.

    """

    DESC = "Aggregates other data servers to present a unified logical view"

    # Keeps track of the first entry in a key, mapping it to a specific data
    # source. The first instance of a key is always authoritative.
    key_mapping_cache = {}

    def __init__(self, *args, **kwargs):
        super(AggregatingDataSource, self).__init__(*args, **kwargs)

        self.data_sources = []

        self.DESC = kwargs.get('desc', self.DESC)

        data_sources = kwargs['data_sources']
        for data_source in data_sources:
            data_server_url = data_source['data_server_url']
            data_source_name = data_source['data_source_name']
            name_is_hash = data_source.get('name_is_hash', False)
            secret_key = data_source['secret_key']

            if name_is_hash:
                data_source_hash = data_source_name
            else:
                data_source_hash = util.generate_ds_key(data_source_name)

            self.data_sources.append({
                "data_server_url": data_server_url,
                "data_source_hash": data_source_hash,
                "secret_key": secret_key
            })

    def list_path(self, path):
        contents = []

        if not path:
            for data_source in self.data_sources:
                paths = self._request_paths_from_ds(data_source, path)
                contents.extend([result_path for result_path in paths
                    if result_path not in contents])

                for result_path in paths:
                    stat_key = result_path['name']
                    if stat_key not in self.key_mapping_cache:
                        self.key_mapping_cache[stat_key] = data_source
        else:
            stat_key = path[0]
            data_source = self._data_source_for_stat_key(stat_key)
            paths = self._request_paths_from_ds(data_source, path)
            contents.extend(paths)

        return contents

    def data(self, sources, start, end, width):
        """TODO(fhats) document this crap"""
        src_count = len(sources)
        result_data = defaultdict(lambda: dict((i, None) for i in xrange(src_count)))
        ds_list = [self._data_source_for_stat_key(source[0]) for source in sources]
        complete_ds = []

        for ds in ds_list:
            if ds not in complete_ds:
                pos_list = [idx for idx, _ in enumerate(sources) if ds_list[idx] == ds]
                source_list = [source for idx, source in enumerate(sources) if ds_list[idx] == ds]

                this_data = self._request_data_from_ds(ds, source_list, start, end, width)
                for data_pt in this_data:
                    for idx, data_val in enumerate(data_pt['v']):
                        pos = pos_list[idx]
                        result_data[data_pt['t']][pos] = data_val

                complete_ds.append(ds)

        result_data = [{'t': t, 'v': self._int_dict_to_list(val_dict)}
            for t, val_dict in sorted(result_data.iteritems(), key=lambda x: x[0])]

        return json.dumps(result_data)

    def _int_dict_to_list(self, d):
        s = sorted(d.iteritems(), key=lambda x: x[0])
        return [so[1] for so in s]

    def legend(self, sources):
        return [[[""], "#ff0000"]]

    def title(self, sources):
        return [""]

    def _request_paths_from_ds(self, data_source, path):
        token = util.generate_access_token(data_source['secret_key'])
        request_path = [data_source['data_source_hash']]

        if path:
            request_path.extend(path)

        base_url = '/'.join((data_source['data_server_url'].rstrip('/'), 'sources'))

        request_params = urlencode({
            'path': json.dumps(request_path),
            'token': token
        })

        request_path = '?'.join((base_url,
            request_params))

        try:
            response = urlopen(request_path)
            return json.loads(response.read())
        except URLError:
            self.logger.exception("Failed to fetch paths for %s from %s" % (
                path, data_source['data_server_url']))
            return []
        except ValueError:
            self.logger.exception("Invalid response received from %s" % data_source['data_server_url'])
            return []

    def _request_data_from_ds(self, data_source, sources, start, end, width):
        token = util.generate_access_token(data_source['secret_key'])
        base_url = '/'.join((data_source['data_server_url'].rstrip('/'), 'data'))

        ds_hash = data_source['data_source_hash']
        request_sources = [[ds_hash] + source for source in sources]

        data_params = {
            'sources': json.dumps(request_sources),
            'start': start,
            'end': end,
            'width': width,
            'token': token
        }
        encoded_data_params = urlencode(data_params)

        url = '?'.join((base_url, encoded_data_params))

        try:
            response = urlopen(url)
        except URLError:
            self.logger.exception("Failed to fetch data for %s from %s" % (
                source, data_source['data_server_url']))

        return json.loads(response.read())

    def _data_source_for_stat_key(self, stat_key):
        if stat_key in self.key_mapping_cache:
            data_source = self.key_mapping_cache[stat_key]
        else:
            data_source = self._find_data_source_for_stat_key(stat_key)
        return data_source

    def _find_data_source_for_stat_key(self, stat_key):
        for data_source in self.data_sources:
            top_level_stats = self._request_paths_from_ds(data_source, None)

            if stat_key in top_level_stats:
                self.key_mapping_cache[stat_key] = data_source
                return data_source
        else:
            return None
