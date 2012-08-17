import os.path
import re

import rrdtool
import ganglia_rrd


ds_re = re.compile('^ds\[(.*)\]*].*')


class StatMonsterRRD(ganglia_rrd.GangliaRRD):
    """Stats from StatMonster"""

    DESC = "StatMonster"

    def __init__(self, *args, **kwargs):
        super(StatMonsterRRD, self).__init__(*args, **kwargs)
        self.GRAPH_ROOT = kwargs['rrdcached_storage']
        self.DAEMON_ADDR = kwargs['rrdcached_socket']

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

    def legend(self, sources):
        if len(sources) == 1:
            return self._svc([[sources[0][-1]]])
        else:
            _sources = ['/'.join([s.split('.')[1] if '.' in s else s for s in src[:-1]]) for src in sources]
            common_root = os.path.commonprefix(_sources)
            out = []
            for idx,src in enumerate(_sources):
                # just....don't ask
                out.append([foo for foo in _sources[idx][len(common_root):].split('/') + [sources[idx][-1]] if foo])
            return self._svc(out)

    def title(self, sources):
        if len(sources) == 1:
            return [src.split('.')[1] for src in sources[0][:-1]]
        else:
            _sources = ['/'.join([s.split('.')[1] if '.' in s else s for s in src[:-1]]) for src in sources]
            common_root = os.path.commonprefix(_sources)
            return common_root.split('/')
