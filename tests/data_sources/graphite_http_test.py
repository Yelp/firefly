# -*- coding: utf-8 -*-
from contextlib import contextmanager
from cStringIO import StringIO
import json
import hamcrest
import mock
import urllib2
import urlparse
from mock import Mock

import testify as T

from firefly.data_sources.graphite_http import GraphiteHTTP
from firefly import util

from hamcrest import starts_with
from hamcrest import contains_string

@contextmanager
def patch_urlopen():
    with mock.patch("firefly.data_sources.graphite_http.urlopen") as mock_urlopen:
        yield mock_urlopen


class match(object):
    """
    Allow use of hamcrest matchers in mock.assert_*(..) methods.

    Example:

        m = Mock()
        m('foo')
        m.assert_called_with(match(starts_with('f')))
    """
    def __init__(self, matcher):
        self.matcher = matcher

    def __eq__(self, other):
        return self.matcher.matches(other)


class GraphiteHTTPTest(T.TestCase):

    ds_url = 'http://dontcare.com:8080'

    @T.setup
    def setup_datasource(self):
        self.ds = GraphiteHTTP(graphite_url=self.ds_url)

    def test_list_path_with_leaf(self):
        """
        Given
            a path that contains a single leaf child node
        When
            path is listed
        Then
            return a single leaf node
        """
        with patch_urlopen() as mock_urlopen:
            mock_response = Mock()
            mock_response.read.return_value = """
            [
                {
                    "leaf": 1,
                    "context": {},
                    "text" : "io_wait",
                    "expandable": 0,
                    "id": "io_wait",
                    "allowChildren": 0
                }
            ]
            """
            mock_urlopen.return_value = mock_response
            result = self.ds.list_path(path=['a','b','c'])
            T.assert_equal(1, len(result))
            expected_servers_dict = {'type': 'file', 'name': u'io_wait'}
            T.assert_dicts_equal(expected_servers_dict, result[0])
            mock_urlopen.assert_called_with(match(starts_with('http://dontcare.com:8080/metrics/find')))
            mock_urlopen.assert_called_with(match(contains_string('query=a.b.c.*')))

    def test_list_path_with_non_leaf(self):
        """
        Given
            a path that contains a single non-leaf child node
        When
            path is listed
        Then
            return a single non-leaf node
        """
        with patch_urlopen() as mock_urlopen:
            mock_response = Mock()
            mock_response.read.return_value = """
            [
                {
                    "leaf": 0,
                    "context": {},
                    "text" : "servers",
                    "expandable": 1,
                    "id": "servers",
                    "allowChildren": 1
                }
            ]
            """
            mock_urlopen.return_value = mock_response
            result = self.ds.list_path(path=['a','b','c'])
            T.assert_equal(1, len(result))
            expected_servers_dict = {'type': 'dir', 'name': u'servers', 'children': None}
            T.assert_dicts_equal(expected_servers_dict, result[0])
            mock_urlopen.assert_called_with(match(starts_with('http://dontcare.com:8080/metrics/find')))
            mock_urlopen.assert_called_with(match(contains_string('query=a.b.c.*')))

    def test_data_single_metric(self):
        sources = [['servers', 'admin1', 'loadavg', '01']]
        start = 1391047920
        end = 1391048100

        with patch_urlopen() as mock_urlopen:
            mock_response = Mock()
            mock_response.read.return_value = """
            [
                {
                    "target": "servers.admin1.loadavg.01",
                    "datapoints": [
                        [2.0, 1391047920],
                        [6.0, 1391047980],
                        [9.0, 1391048040],
                        [null,1391048100]
                    ]
                }
            ]
            """
            mock_urlopen.return_value = mock_response
            result_json = self.ds.data(sources, start, end, width=100)

            expected_results = [
                { 't': 1391047920, 'v': [2.0]},
                { 't': 1391047980, 'v': [6.0]},
                { 't': 1391048040, 'v': [9.0]},
                { 't': 1391048100, 'v': [None]}
            ]

            result_list = json.loads(result_json)
            T.assert_equal(4, len(result_list))

            for i,expected_result in enumerate(expected_results):
                T.assert_dicts_equal(expected_result, result_list[i])

            mock_urlopen.assert_called_with(match(starts_with('http://dontcare.com:8080/render')))
            mock_urlopen.assert_called_with(match(contains_string('.'.join(sources[0]))))

    def test_data_multiple_metrics(self):
        sources = [
            ['servers', 'admin1', 'loadavg', '01'],
            ['servers', 'admin2', 'loadavg', '01'],
        ]
        start = 1391047920
        end = 1391048100

        with patch_urlopen() as mock_urlopen:
            mock_admin1_response = Mock()
            mock_admin1_response.read.return_value = """
            [
                {
                    "target": "servers.admin1.loadavg.01",
                    "datapoints": [
                        [2.0, 1391047920],
                        [6.0, 1391047980],
                        [9.0, 1391048040],
                        [null,1391048100]
                    ]
                }
            ]
            """

            mock_admin2_response = Mock()
            mock_admin2_response.read.return_value = """
            [
                {
                    "target": "servers.admin2.loadavg.01",
                    "datapoints": [
                        [1.0, 1391047920],
                        [7.0, 1391047980],
                        [10.0, 1391048040],
                        [null,1391048100]
                    ]
                }
            ]
            """
            mock_urlopen.side_effect = [mock_admin1_response, mock_admin2_response]
            result_json = self.ds.data(sources, start, end, width=100)
                        # [null, 1391048100]

            expected_results = [
                { 't': 1391047920, 'v': [2.0, 1.0]},
                { 't': 1391047980, 'v': [6.0, 7.0]},
                { 't': 1391048040, 'v': [9.0, 10.0]},
                { 't': 1391048100, 'v': [None, None]}
            ]

            result_list = json.loads(result_json)
            T.assert_equal(4, len(result_list))

            for i,expected_result in enumerate(expected_results):
                T.assert_dicts_equal(expected_result, result_list[i])

            T.assert_equal(2, mock_urlopen.call_count)