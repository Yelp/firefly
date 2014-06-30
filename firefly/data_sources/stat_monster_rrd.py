import os.path
import re

import rrdtool
import ganglia_rrd


ds_re = re.compile('^ds\[(.*)\]*].*')

map_res = {'histogram': re.compile('^hist_(\d\d)_count$')}

class StatMonsterRRD(ganglia_rrd.GangliaRRD):
    """Stats from StatMonster"""

    DESC = "StatMonster"

    path_splitter = "."

    def __init__(self, *args, **kwargs):
        super(StatMonsterRRD, self).__init__(*args, **kwargs)
        self.GRAPH_ROOT = kwargs['rrdcached_storage']
        self.DAEMON_ADDR = kwargs['rrdcached_socket']

    def list_path(self, path):
        contents = super(StatMonsterRRD, self).list_path(path)
        map_contents = [] 
        for k, v in map_res.items():
            if any(v.match(s['name']) for s in contents):
                map_contents.append({'type': 'file',
                'name': k,
                'data_type': 'map'
                })
        contents = filter(lambda s: not any(r.match(s['name']) for r in map_res.values()), contents)
        contents.extend(map_contents)
        return contents

    def _form_entries_from_file(self, root, name):
        info = rrdtool.info(str(os.path.join(root, name)))
        dses = set()
        for entry in info.keys():
            match = ds_re.match(entry)
            if match:
                dses.add(match.group(1))

        return [{'type': 'file', 'name': "%s_%s" % (name[:-4], stat)} for stat in sorted(list(dses))]

    def _form_def(self, idx, src):
        src_root = src[:-1]
        try:
            src_file_basenamea, source_file_basenameb, ds_name = src[-1].split('_', 2)
            src_file_basename = '_'.join((src_file_basenamea, source_file_basenameb))
        except:
            src_file_basename, ds_name = src[-1].rsplit('_', 1)

        fn = "%s/%s/%s.rrd" % (self.GRAPH_ROOT, '/'.join(src_root), src_file_basename)

        return "DEF:ds%d=%s:%s:AVERAGE" % (idx, fn, ds_name)

    def mapdata(self, sources, start, end, width):
        """2D bitmap data source.
        Return value is a dictionary with two values.
        y is the y axis value list, which is a sorted integer number.
        d should have same number of items, each one corresponds to the (t, v) values of y at the same possition.
        """
        assert len(sources) == 1
        for k, v in map_res.items():
            if k == sources[0][-1]:
                _sources = []
                contents = super(StatMonsterRRD, self).list_path(sources[0][:-1])
                names = sorted([i['name'] for i in filter(lambda s: v.match(s['name']), contents)])
                _sources = [sources[0][:-1] + [i] for i in names] 
                data = super(StatMonsterRRD, self).data(_sources, start, end, width).replace('null','0') 
                y = [str(int(v.match(i).group(1))) for i in names]  
        return "[{\"y\":["+",".join(y)+"],\"d\":"+data+"}]" 
