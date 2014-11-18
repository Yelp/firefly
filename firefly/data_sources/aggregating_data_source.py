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

    This data source takes a few arguments:

    * desc - Provides a description of this data source. You probably want
        to set this to be the same as the description of the data sources
        that this aggregates.
    * data_sources - A list of dictionaries defining information about data
        sources to pull from. Each entry in data_sources should have the
        following entries:

        * data_server_url: The URL of the data server which is serving data
            from this data source
        * data_source_name: The full dotted-path class name of the data source
            at `data_server_url` which data should be retrieved from. This
            should correspond to an entry in the `data_sources` section of
            the data server configuration at `data_server_url`. This value
            can also be set to the internal hash of the data source name,
            in which case `name_is_hash` should be set to True.
        * secret_key: The secret key the data server at `data_server_url` is
            using.
        * name_is_hash (optional): Whether or not the string in
            `data_source_name` is an internal hash of the data source name.
            Defaults to False.
    """

    DESC = "Aggregates other data sources"

    def __init__(self, *args, **kwargs):
        """Reads the configuration passed to it and holds on to the data
        sources that are available to this data source.
        """
        super(AggregatingDataSource, self).__init__(*args, **kwargs)

        self.data_sources = []

        self.DESC = kwargs.get('desc', self.DESC)

        # Keeps track of the first entry in a key, mapping it to a specific data
        # source. The first instance of a key is always authoritative.
        self.key_mapping_cache = {}

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
        """Provides a list of paths available for this data source.

        If no path is provided, list all the root paths from all data sources.
        If a path is provided, we'll list the sub-paths available only from
        the pertinent data source. Fills out self._key_mapping_cache as it
        goes.
        """
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
        """Provides data from the appropriate data sources for the given
        sources.

        The way this method works is a little bit convoluted, since it
        attempts to batch requests so that each data source is only contacted
        once. Result information is kept in a dictionary that looks like:
        {
            'timestamp': {
                0: 'value',
                1: 'value',
                ...
                len(sources): 'value'
            },
            'timestamp': ...
            ...
        }

        Sources are grouped by the data source from which their data can be
        retrieved. After the batched request for data from the data source,
        the retrieved data is exploded back into this result dictionary by
        placing each value retrieved into the sub-dictionary for the timestamp
        under the key corresponding to that source's position in the original
        `sources` argument. This results dictionary is then collapsed down
        into a format that the firefly data server can speak.
        """
        src_count = len(sources)
        # Create a dictionary which has keys as timestamps and values which
        # are dictionaries of integers representing the position of the source
        # in `sources` mapping to a single value, which is the value of the
        # source in that position at that timestamp.
        result_data = defaultdict(lambda: dict((i, None) for i in xrange(src_count)))
        # Find the appropriate data source for each source. Each data source
        # in this list corresponds to the data source for the source in the
        # same position in `sources`.
        ds_list = [self._data_source_for_stat_key(source[0]) for source in sources]
        # Tracks data sources that have already been contacted.
        complete_ds = []  # list because we can't hash dicts

        # Walk the data source list, keeping track of ones we've already hit
        # so that we only hit each data source once
        for ds in ds_list:
            if ds not in complete_ds:
                # Build up a list of positions in `sources` that can be
                # serviced by this data source.
                pos_list = [idx for idx, _ in enumerate(sources) if ds_list[idx] == ds]
                # Build up a list of sources which map to pos_list. Each source
                # in this list maps to an entry in pos_list, which is this
                # sources position in the `sources` argument
                source_list = [source for idx, source in enumerate(sources) if ds_list[idx] == ds]

                # Ask for data from this data source for these sources
                this_data = self._request_data_from_ds(ds, source_list, start, end, width)
                # Once we get data back, explode the values retrieved back into
                # result_data for the position each source corresponds to.
                for data_pt in this_data:
                    for idx, data_val in enumerate(data_pt['v']):
                        pos = pos_list[idx]
                        result_data[data_pt['t']][pos] = data_val

                complete_ds.append(ds)

        # Now create a cogent result which speaks the data_server protocol.
        # This just basically flattens our result_data dictionary into a list
        # of dictionaries and flattens the dictionaries of source position->value
        # into lists of values in the correct order.
        result_data = [{'t': t, 'v': self._int_dict_to_list(val_dict)}
            for t, val_dict in sorted(result_data.iteritems(), key=lambda x: x[0])]

        return json.dumps(result_data)

    def _int_dict_to_list(self, d):
        """Given a dictionary with keys that are integers, 'flattens' the dict
        into a list with the order specified by the keys of the dict.

        For example, if given:
            {
                1: 'a',
                2: 'b',
                3: 'c'
            }
        this method will return:
            ['a', 'b', 'c']
        """
        # Sort by keys in the dict
        sorted_items = sorted(d.iteritems(), key=lambda x: x[0])
        # and flatten into a single list in the sorted order
        return [item[1] for item in sorted_items]

    def _request_paths_from_ds(self, data_source, path):
        """Does the work of retrieving the available paths from the specified
        data source.

        If path is falsey, all of the top-level paths that the data source
        can serve are returned. If a path is provided, a regular list_sources
        request is sent to the underlying data server.
        """
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
        """Does the work of retrieving stats data from a given data source.

        Sources is a list of sources (which are lists of strings) to retrieve
        stats for; this allows callers to batch requests for data from the same
        data source into a single request. Data is returned in the same format
        that the data server returns it in, which is a list of dicts containing
        two keys: 't' and 'v'. 't' is always the timestamp of the data points,
        and 'v' is a list of values for time 't'. The values in 'v' are always
        in the order that they were requested; if sources was ['a', 'b'], 'v'
        will always be data for 'a', then data for 'b'. Overall, the returned
        structure looks like so:

        [
            {
                't': 10000000,
                'v': [500, 400, ...]
            },
            {
                't': 10000001,
                'v': [505, 391, ...]
            },
            ...
        ]

        `start`, `end`, and `width` are all passed along unmodified to the
        data source.
        """
        token = util.generate_access_token(data_source['secret_key'])
        base_url = '/'.join((data_source['data_server_url'].rstrip('/'), 'data'))

        ds_hash = data_source['data_source_hash']
        # Sprinkle in the hash of the data source we're talking to so complete
        # the source specification
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
            return json.loads(response.read())
        except URLError:
            self.logger.exception("Failed to fetch data for %s from %s" % (
                source, data_source['data_server_url']))
            return []


    def _data_source_for_stat_key(self, stat_key):
        """Given a 'top-level' source item (i.e. the first item in a source),
        returns a data source which can serve data and paths for that key.

        Checks self.key_mapping_cache first. If there's no entry in that dict,
        a data source is determined according to _find_data_source_for_stat_key.
        """
        if stat_key in self.key_mapping_cache:
            data_source = self.key_mapping_cache[stat_key]
        else:
            data_source = self._find_data_source_for_stat_key(stat_key)
        return data_source

    def _find_data_source_for_stat_key(self, stat_key):
        """Given a top-level source item that we don't know an appropriate
        data source for, checks all the data sources we know about until
        it finds a data source that can provide source lists and data for
        that stat key.
        """
        for data_source in self.data_sources:
            top_level_stats = self._request_paths_from_ds(data_source, None)

            if stat_key in [stat['name'] for stat in top_level_stats]:
                self.key_mapping_cache[stat_key] = data_source
                return data_source
        else:
            return None
