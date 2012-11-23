import colorsys
from itertools import izip
import json
import os
import os.path

import whisper

import firefly.data_source


class GraphiteWSP(firefly.data_source.DataSource):
    """Stats from Graphite's Whisperdb files"""

    DESC = "Graphite"

    def __init__(self, *args, **kwargs):
        super(GraphiteWSP, self).__init__(*args, **kwargs)
        self.GRAPH_ROOT = kwargs['graphite_storage']

    def list_path(self, path):
        """given an array of path components, list the (presumable) directory"""
        contents = []
        root = self.GRAPH_ROOT if not path else os.path.join(self.GRAPH_ROOT, os.path.join(*path))
        for name in sorted(os.listdir(root)):
            if os.path.isdir(os.path.join(root, name)):
                entries = self._form_entries_from_dir(root, name)
                if entries:
                    contents.extend(entries)
            else:
                entries = self._form_entries_from_file(root, name)
                if entries:
                    contents.extend(entries)
        return contents

    def _form_entries_from_dir(self, root, name):
        return [{'type': 'dir', 'name': name, 'children': None}]

    def _form_entries_from_file(self, root, name):
        return [{'type': 'file', 'name': name[:-4]}]

    def _svc(self, sources):
        colorstep = 1.0 / len(sources)
        svc = zip(sources, ("#%s" % ("%02x%02x%02x" % colorsys.hsv_to_rgb(i*colorstep, 1, 255)) for i in xrange(len(sources))))
        return svc

    def data(self, sources, start, end, width):
        serieses = []
        for source in sources:
            path = os.path.join(self.GRAPH_ROOT, "%s.wsp" % (os.path.join(*source),))
            timeInfo, values = whisper.fetch(path, start, end)
            print len(values)
            start, end, step = timeInfo
            serieses.append(values)

        out = []
        for timestamp, values in izip(xrange(start, end, step), izip(*serieses)):
            out.append({'t': timestamp, 'v': [v for v in values]})
        return json.dumps(out)

    def legend(self, sources):
        return self._svc(sources)

    def title(self, sources):
        return ["graphite"]
