import math
import os
import os.path
import subprocess
import tornado.web
import xml.etree.cElementTree as ET

import firefly.data_source


class GangliaRRD(firefly.data_source.DataSource):
    """Stats from Ganglia"""

    DESC = "Ganglia Stats"

    path_splitter = ""

    def __init__(self, *args, **kwargs):
        super(GangliaRRD, self).__init__(*args, **kwargs)
        self.DAEMON_ADDR = kwargs['rrdcached_socket']
        self.GRAPH_ROOT = kwargs['rrdcached_storage']

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

    def _form_def(self, idx, source):
        source = "%s.rrd" % '/'.join(source)
        return "DEF:ds%d=%s/%s:sum:AVERAGE" % (idx, self.GRAPH_ROOT, os.path.join(*source.split('/')))

    def data(self, sources, start, end, width):
        opts = [
            "/usr/bin/rrdtool", "xport",
            "--start", str(start),
            "--end",  str(end),
            "--maxrows", str(width)]

        conditionals = [
            # flush rrdcached before making graph
            (self.DAEMON_ADDR, ['--daemon', self.DAEMON_ADDR])]

        for condition, optlist in conditionals:
            if condition:
                opts.extend(optlist)

        defs = []
        lines = []
        for idx, source in enumerate(sources):
            defs.append(self._form_def(idx, source))
            lines.append("XPORT:ds%d" % idx)

        pipe = subprocess.Popen(opts + defs + lines, stdout=subprocess.PIPE)
        xport_stdout, xport_stderr = pipe.communicate()
        if pipe.returncode != 0:
            raise tornado.web.HTTPError(500, log_message=xport_stderr)

        data = []
        try:
            for row in ET.fromstring(xport_stdout).findall("data/row"):
                time = int(row.findtext("t"))
                values = []
                for v in row.findall("v"):
                    value = float(v.text)
                    values.append("%g" % value if not math.isnan(value) else None)
                values_string = ",".join(v if v else "null" for v in values)
                data.append('{"t":%d,"v":[%s]}' % (time, values_string))
        except Exception, e:
            raise tornado.web.HTTPError(500, log_message=str(e))

        return "[%s]" % ",".join(data)
