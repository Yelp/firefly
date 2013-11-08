# -*- coding: utf-8 -*-
"""Contains tests for the AggregatingDataSource."""
from contextlib import contextmanager
from cStringIO import StringIO
import json
import mock
import urllib2
import urlparse

import testify as T

from firefly.data_sources.aggregating_data_source import AggregatingDataSource
from firefly import util


class AggregatingDataSourceTest(T.TestCase):

	test_data_sources = [
		{
			'data_server_url': "http://a.com",
			'data_source_name': "some.data.source",
			'secret_key': "TEST_SECRET_ONE"
		},
		{
			'data_server_url': "http://b.com",
			'data_source_name': "another.data.source",
			'name_is_hash': False,
			'secret_key': "TEST_SECRET_TWO"
		},
		{
			'data_server_url': "http://c.com",
			'data_source_name': 'ae22d4c',
			'name_is_hash': True,
			'secret_key': "TEST_SECRET_THREE"
		}
	]

	@T.setup
	def setup_data_source(self):
		self.data_source = AggregatingDataSource(data_sources=self.test_data_sources)

	def test_init_ds_args(self):
		"""Make sure that just passing in data source information constructs
		an AggregatingDataSource with the expected attributes.
		"""

		expected_data_sources = [
			{
				'data_server_url': "http://a.com",
				'data_source_hash': util.generate_ds_key("some.data.source"),
				'secret_key': "TEST_SECRET_ONE"
			},
			{
				'data_server_url': "http://b.com",
				'data_source_hash': util.generate_ds_key("another.data.source"),
				'secret_key': "TEST_SECRET_TWO"
			},
			{
				'data_server_url': "http://c.com",
				'data_source_hash': 'ae22d4c',
				'secret_key': "TEST_SECRET_THREE"
			}
		]

		T.assert_equal(self.data_source.data_sources, expected_data_sources)

		desc_data_source = AggregatingDataSource(data_sources=self.test_data_sources,
			desc=mock.sentinel.test_desc)
		T.assert_equal(desc_data_source.data_sources, expected_data_sources)
		T.assert_equal(desc_data_source.DESC, mock.sentinel.test_desc)

	def test_list_path_no_path(self):
		"""Tests the behavior of list_path when asking for the root keys (no
		path specified).
		"""
		test_path = None

		expected_paths = [{
			'name': 'src.MajorSource%d' % i,
			'type': 'dir'
		} for i in xrange(len(self.data_source.data_sources))]

		with self._mock_ds_method('_request_paths_from_ds') as mock_request_paths:
			mock_request_paths.side_effect = [[path] for path in expected_paths]

			actual_paths = self.data_source.list_path(test_path)

			T.assert_equal(mock_request_paths.call_count, len(self.data_source.data_sources))

			for ds in self.data_source.data_sources:
				mock_request_paths.assert_any_call(ds, test_path)

		T.assert_equal(expected_paths, actual_paths)

		for expected_path, expected_data_source in zip(expected_paths, self.data_source.data_sources):
			T.assert_in(expected_path['name'], self.data_source.key_mapping_cache)
			T.assert_equal(self.data_source.key_mapping_cache[expected_path['name']], expected_data_source)

	def test_list_path_no_path_duplicates(self):
		"""Tests that when no path is specified the correct results are returned
		and the repeat key is not cached with the wrong data source.
		"""
		test_path = None

		expected_paths = [{
			'name': 'src.MajorSource%d' % i,
			'type': 'dir'
		} for i in xrange(len(self.data_source.data_sources))]

		with self._mock_ds_method('_request_paths_from_ds') as mock_request_paths:
			mock_request_path_list = [[path] for path in expected_paths]
			mock_request_path_list[-1].append({
				'name': 'src.MajorSource1',
				'type': 'dir'
			})
			mock_request_paths.side_effect = mock_request_path_list

			actual_paths = self.data_source.list_path(test_path)

			T.assert_equal(mock_request_paths.call_count, len(self.data_source.data_sources))

			for ds in self.data_source.data_sources:
				mock_request_paths.assert_any_call(ds, test_path)

		T.assert_equal(expected_paths, actual_paths)

		for expected_path, expected_data_source in zip(expected_paths, self.data_source.data_sources):
			T.assert_in(expected_path['name'], self.data_source.key_mapping_cache)
			T.assert_equal(self.data_source.key_mapping_cache[expected_path['name']], expected_data_source)

	def test_list_path(self):
		"""Tests the behavior of list_path when a path is specified."""
		test_path = ['src.MajorSource1']

		expected_paths = [{
			'name': 'src.minorSource%d' % i,
			'type': 'dir'
		} for i in xrange(5)]

		with self._mock_ds_method('_request_paths_from_ds') as mock_request_paths:
			with self._mock_ds_method('_data_source_for_stat_key') as mock_ds_for_stat_key:
				mock_ds_for_stat_key.return_value = self.data_source.data_sources[1]
				mock_request_paths.return_value = [path for path in expected_paths]

				actual_paths = self.data_source.list_path(test_path)

				mock_ds_for_stat_key.assert_called_once_with(test_path[0])
				mock_request_paths.assert_called_once_with(self.data_source.data_sources[1], test_path)

		T.assert_equal(expected_paths, actual_paths)

	def test_data_single_from_single_source(self):
		"""Tests the behavior of data when asking for a single source."""
		test_data_source = self.data_source.data_sources[2]
		test_stat = [['src.MajorSourceA', 'key.minorStat1', 'variant.Blue', '50th_percentile']]
		test_start = 100
		test_end = 200
		test_width = 500

		dummy_data = [
			{
				't': 500,
				'v': [120]
			},
			{
				't': 505,
				'v': [140]
			},
			{
				't': 510,
				'v': [160]
			}
		]
		expected_data = json.dumps(dummy_data)

		with self._mock_ds_method('_data_source_for_stat_key') as mock_ds_for_stat_key:
			with self._mock_ds_method('_request_data_from_ds') as mock_request_data:
				mock_ds_for_stat_key.return_value = test_data_source
				mock_request_data.return_value = dummy_data

				actual_data = self.data_source.data(test_stat, test_start, test_end, test_width)

				mock_ds_for_stat_key.assert_called_once_with(test_stat[0][0])
				mock_request_data.assert_called_once_with(test_data_source, test_stat, test_start, test_end, test_width)

		T.assert_equal(expected_data, actual_data)

	def test_data_multiple_from_single_source(self):
		"""Tests the behavior of data when asking for multiple stats from a
		single source.
		"""
		test_data_source = self.data_source.data_sources[2]
		test_stats = [
			['src.MajorSourceA', 'key.minorStat1', 'variant.Blue', '50th_percentile'],
			['src.MajorSourceA', 'key.minorStat1', 'variant.Red', '75th_percentile']
		]
		test_start = 100
		test_end = 200
		test_width = 500

		dummy_data = [
			{
				't': 500,
				'v': [120, 190]
			},
			{
				't': 505,
				'v': [140, 200]
			},
			{
				't': 510,
				'v': [160, 40]
			}
		]
		expected_data = json.dumps(dummy_data)

		with self._mock_ds_method('_data_source_for_stat_key') as mock_ds_for_stat_key:
			with self._mock_ds_method('_request_data_from_ds') as mock_request_data:
				mock_ds_for_stat_key.side_effect = [test_data_source, test_data_source]
				mock_request_data.return_value = dummy_data

				actual_data = self.data_source.data(test_stats, test_start, test_end, test_width)

				T.assert_equal(mock_ds_for_stat_key.call_count, len(test_stats))
				for stat in test_stats:
					mock_ds_for_stat_key.assert_any_call(stat[0])

				mock_request_data.assert_called_once_with(test_data_source, test_stats, test_start, test_end, test_width)

		T.assert_equal(expected_data, actual_data)

	def test_data_multiple_from_multiple_sources(self):
		"""Tests the behavior of data when asking for multiple stats from
		multiple sources.
		"""
		# A -> 0, B -> 1, C -> 2 in self.data_source.data_sources
		test_stats = [
			['src.MajorSourceA', 'key.minorStat1', 'variant.Blue', '50th_percentile'],
			['src.MajorSourceB', 'key.minorStatGolf', 'variant.eskimo', 'count'],
			['src.MajorSourceA', 'key.minorStat1', 'variant.Red', '75th_percentile'],
			['src.MajorSourceC', 'key.minorStatPidgeon', 'variant.alice', 'dart']
		]
		test_start = 100
		test_end = 200
		test_width = 500

		# Lists data in the order of the data sources that will be asked
		dummy_data_list = [
			[
				{
					't': 500,
					'v': [120, 190]
				},
				{
					't': 505,
					'v': [140, 200]
				},
				{
					't': 510,
					'v': [160, 40]
				}
			],
			[
				{
					't': 496,
					'v': [90]
				},
				{
					't': 499,
					'v': [93]
				},
				{
					't': 505,
					'v': [101]
				},
				{
					't': 510,
					'v': [100]
				}
			],
			[
				{
					't': 500,
					'v': [4]
				},
				{
					't': 507,
					'v': [10]
				},
				{
					't': 510,
					'v': [4]
				},
				{
					't': 512,
					'v': [8]
				}
			]
		]

		# Derived from dummy_data_list
		expected_data = json.dumps([
			{
				't': 496,
				'v': [None, 90, None, None]
			},
			{
				't': 499,
				'v': [None, 93, None, None]
			},
			{
				't': 500,
				'v': [120, None, 190, 4]
			},
			{
				't': 505,
				'v': [140, 101, 200, None]
			},
			{
				't': 507,
				'v': [None, None, None, 10]
			},
			{
				't': 510,
				'v': [160, 100, 40, 4]
			},
			{
				't': 512,
				'v': [None, None, None, 8]
			}
		])

		with self._mock_ds_method('_data_source_for_stat_key') as mock_ds_for_stat_key:
			with self._mock_ds_method('_request_data_from_ds') as mock_request_data:
				mock_ds_for_stat_key.side_effect = [
					self.data_source.data_sources[0],
					self.data_source.data_sources[1],
					self.data_source.data_sources[0],
					self.data_source.data_sources[2],
				]
				mock_request_data.side_effect = dummy_data_list

				actual_data = self.data_source.data(test_stats, test_start, test_end, test_width)

				T.assert_equal(mock_ds_for_stat_key.call_count, len(test_stats))
				for stat in test_stats:
					mock_ds_for_stat_key.assert_any_call(stat[0])

				T.assert_equal(mock_request_data.call_count, 3)
				mock_request_data.assert_any_call(self.data_source.data_sources[0],
					[test_stats[0], test_stats[2]], test_start, test_end, test_width)
				mock_request_data.assert_any_call(self.data_source.data_sources[1],
					[test_stats[1]], test_start, test_end, test_width)
				mock_request_data.assert_any_call(self.data_source.data_sources[2],
					[test_stats[3]], test_start, test_end, test_width)

		T.assert_equal(expected_data, actual_data)

	def test_int_dict_to_list(self):
		"""Just a quick test for the positive path of _int_dict_to_list."""
		test_dict = {
			1: 'a',
			2: 'b',
			3: ['c', {'a': 'i'}],
			4: 0,
			11: 'cya'
		}

		expected_list = ['a', 'b', ['c', {'a': 'i'}], 0, 'cya']
		actual_list = self.data_source._int_dict_to_list(test_dict)

		T.assert_equal(expected_list, actual_list)

	def test_request_paths_from_ds(self):
		"""Tests the behavior of _request_paths_from_ds when a path is
		specified.
		"""
		test_data_source = self.data_source.data_sources[0]
		test_path = ['src.A']

		mock_paths = ['key.D', 'key.E', 'key.F']

		expected_ask_path = json.dumps([test_data_source['data_source_hash']] + test_path)
		expected_paths = mock_paths
		expected_token = util.generate_access_token(test_data_source['secret_key'])

		with self._patch_urlopen() as mock_urlopen:
			mock_urlopen.return_value = StringIO(json.dumps(mock_paths))
			actual_paths = self.data_source._request_paths_from_ds(test_data_source, test_path)

			T.assert_equal(mock_urlopen.call_count, 1)
			T.assert_equal(mock_paths, actual_paths)  # 'cause why not?
			T.assert_equal(len(mock_urlopen.call_args[0]), 1)

			submitted_url = mock_urlopen.call_args[0][0]
			parsed_url = urlparse.urlparse(submitted_url)
			query_params = urlparse.parse_qs(parsed_url.query)

			T.assert_equal(parsed_url.scheme, 'http')
			T.assert_equal(parsed_url.path, '/sources')
			T.assert_equal(parsed_url.fragment, '')

			T.assert_equal(query_params['path'], [expected_ask_path])
			T.assert_equal(query_params['token'], [expected_token])

			T.assert_equal(actual_paths, expected_paths)

	def test_request_paths_from_ds_no_path(self):
		"""Tests the behavior of _request_paths_from_ds when no path is
		specified."""
		test_data_source = self.data_source.data_sources[0]
		test_path = None

		mock_paths = ['src.A', 'src.B', 'src.C']

		expected_ask_path = json.dumps([test_data_source['data_source_hash']])
		expected_paths = mock_paths
		expected_token = util.generate_access_token(test_data_source['secret_key'])

		with self._patch_urlopen() as mock_urlopen:
			mock_urlopen.return_value = StringIO(json.dumps(mock_paths))
			actual_paths = self.data_source._request_paths_from_ds(test_data_source, test_path)

			T.assert_equal(mock_urlopen.call_count, 1)
			T.assert_equal(mock_paths, actual_paths)  # 'cause why not?
			T.assert_equal(len(mock_urlopen.call_args[0]), 1)

			submitted_url = mock_urlopen.call_args[0][0]
			parsed_url = urlparse.urlparse(submitted_url)
			query_params = urlparse.parse_qs(parsed_url.query)

			T.assert_equal(parsed_url.scheme, 'http')
			T.assert_equal(parsed_url.path, '/sources')
			T.assert_equal(parsed_url.fragment, '')

			T.assert_equal(query_params['path'], [expected_ask_path])
			T.assert_equal(query_params['token'], [expected_token])

			T.assert_equal(actual_paths, expected_paths)

	def test_request_paths_from_ds_url_error(self):
		"""Tests that _request_paths_from_ds returns an empty list if it
		can't contact the data_server.
		"""
		test_data_source = self.data_source.data_sources[0]
		test_path = None

		expected_paths = []

		with self._patch_urlopen() as mock_urlopen:
			with self._mock_ds_method('logger') as mock_logger:
				# Set urlopen raise a URLError
				mock_urlopen.side_effect = urllib2.URLError("Couldn't talk to the data server")
				actual_paths = self.data_source._request_paths_from_ds(test_data_source, test_path)

				T.assert_equal(mock_urlopen.call_count, 1)
				T.assert_equal(actual_paths, expected_paths)
				mock_logger.exception.assert_called_once_with("Failed to fetch paths for %s from %s" % (test_path, test_data_source['data_server_url']))

	def test_request_paths_from_ds_invalid_response(self):
		"""Tests that _request_paths_from_ds returns an empty list if it
		can't parse the result of its interaction with the data server.
		"""
		test_data_source = self.data_source.data_sources[0]
		test_path = None

		expected_paths = []

		with self._patch_urlopen() as mock_urlopen:
			with self._mock_ds_method('logger') as mock_logger:
				# Set urlopen to return a result that can't be JSON parsed
				mock_urlopen.return_value = StringIO("[{{1_\]")
				actual_paths = self.data_source._request_paths_from_ds(test_data_source, test_path)

				T.assert_equal(mock_urlopen.call_count, 1)
				T.assert_equal(actual_paths, expected_paths)
				mock_logger.exception.assert_called_once_with("Invalid response received from %s" % test_data_source['data_server_url'])

	def test_request_data_from_ds(self):
		"""Checks that _request_data_from_ds knows how to ask for data from
		other data servers correctly.

		TODO(fhats): This can certainly benefit from some integration tests.
		"""
		test_data_source = self.data_source.data_sources[0]
		test_sources = [
			['src.EndpointTIming', 'stat.A', 'variant.logged_in'],
			['src.ErrorCount', 'stat.B', 'variant.logged_out']
		]
		test_start = 100
		test_end = 200
		test_width = 30

		expected_sources = map(lambda x: [test_data_source['data_source_hash']] + x, test_sources)
		expected_token = util.generate_access_token(test_data_source['secret_key'])

		with self._patch_urlopen() as mock_urlopen:
			# Just sprinkle some mock data to return
			mock_data = [
				{
					't': 150,
					'v': [5, 6]
				},
				{
					't': 160,
					'v': [9, 10]
				}
			]
			mock_urlopen.return_value = StringIO(json.dumps(mock_data))
			returned_data = self.data_source._request_data_from_ds(test_data_source,
				test_sources,
				test_start,
				test_end,
				test_width)
			T.assert_equal(mock_urlopen.call_count, 1)
			T.assert_equal(mock_data, returned_data)  # 'cause why not?
			T.assert_equal(len(mock_urlopen.call_args[0]), 1)

			submitted_url = mock_urlopen.call_args[0][0]
			parsed_url = urlparse.urlparse(submitted_url)
			query_params = urlparse.parse_qs(parsed_url.query)

			T.assert_equal(parsed_url.scheme, 'http')
			T.assert_equal(parsed_url.path, '/data')
			T.assert_equal(parsed_url.fragment, '')

			T.assert_equal(query_params['sources'], [json.dumps(expected_sources)])
			T.assert_equal(query_params['start'], [str(test_start)])
			T.assert_equal(query_params['end'], [str(test_end)])
			T.assert_equal(query_params['width'], [str(test_width)])
			T.assert_equal(query_params['token'], [expected_token])

	def test_data_source_for_stat_key_in_cache(self):
		"""Tests that _data_source_for_stat_key uses the key_mapping_cache if
		it can.
		"""
		expected_data_source = self.data_source.data_sources[2]

		stat_key = 'src.test_stat_key'

		self.data_source.key_mapping_cache[stat_key] = expected_data_source

		with self._mock_ds_method('_find_data_source_for_stat_key') as mock_find_ds_for_stat:
			actual_ds = self.data_source._data_source_for_stat_key(stat_key)

			T.assert_equal(mock_find_ds_for_stat.call_count, 0)

		T.assert_equal(actual_ds, expected_data_source)

	def test_data_source_for_stat_key_not_cached(self):
		"""Tests that _data_source_for_stat_key asks _find_data_source_for_stat_key
		if the stat key isn't cached in the key_mapping_cache.
		"""
		expected_data_source = self.data_source.data_sources[2]

		stat_key = 'src.test_stat_key'

		with self._mock_ds_method('_find_data_source_for_stat_key') as mock_find_ds_for_stat:
			mock_find_ds_for_stat.return_value = expected_data_source
			actual_ds = self.data_source._data_source_for_stat_key(stat_key)

			mock_find_ds_for_stat.assert_called_once_with(stat_key)

		T.assert_equal(actual_ds, expected_data_source)

	def test_find_data_source_for_stat_key(self):
		"""Tests _find_data_source_for_stat_key when it's provided by one of
		the configured data sources.
		"""

		expected_data_source = {
			'data_server_url': "http://b.com",
			'data_source_hash': util.generate_ds_key("another.data.source"),
			'secret_key': "TEST_SECRET_TWO"
		}

		test_key = 'src.our_key'

		def fake_paths_from_ds(data_source, path):
			if data_source == expected_data_source:
				return [{"name": test_key},]
			else:
				return [{"name": "src.not_our_key"},]

		with mock.patch.object(self.data_source, '_request_paths_from_ds', fake_paths_from_ds):
			actual_ds = self.data_source._find_data_source_for_stat_key(test_key)

		T.assert_equal(expected_data_source, actual_ds)
		T.assert_in(test_key, self.data_source.key_mapping_cache)
		T.assert_equal(expected_data_source, self.data_source.key_mapping_cache[test_key])

	def test_find_data_source_for_stat_key_not_found(self):
		"""Tests _find_data_source_for_stat_key's behavior when the stat_key
		isn't made available by any data sources.
		"""

		expected_data_source = None
		test_key = 'src.some_test_stat'

		with self._mock_ds_method('_request_paths_from_ds') as mock_request_paths:
			mock_request_paths.return_value = [{"name": "a"}, {"name": "b"}, {"name": "c"}]
			actual_ds = self.data_source._find_data_source_for_stat_key(test_key)
			T.assert_equal(mock_request_paths.call_count, len(self.test_data_sources))
			for ds in self.data_source.data_sources:
				mock_request_paths.assert_any_call(ds, None)

		T.assert_equal(expected_data_source, actual_ds)

	@contextmanager
	def _patch_urlopen(self):
		with mock.patch("firefly.data_sources.aggregating_data_source.urlopen") as mock_urlopen:
			yield mock_urlopen

	@contextmanager
	def _mock_ds_method(self, method):
		with mock.patch.object(self.data_source, method) as mock_thing:
			yield mock_thing
