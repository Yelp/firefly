import colorsys
import logging
import os.path


class DataSource(object):
    """Base class for Firefly Data Sources"""

    DESC = "Base class for Firefly Data Sources"

    def __init__(self, *args, **kwargs):
        self.logger = logging.getLogger(__name__)

    def list_path(self, path):
        """given an array of path components, list the (presumable) directory"""
        raise NotImplemented

    def graph(self):
        raise NotImplemented

    def data(self):
        raise NotImplemented

    def _svc(self, sources):
        colorstep = 1.0 / len(sources)
        svc = zip(sources, ("#%s" % ("%02x%02x%02x" % colorsys.hsv_to_rgb(i * colorstep, 1, 255)) for i in xrange(len(sources))))
        return svc

    def legend(self, sources):
        if len(sources) == 1:
            return self._svc([[sources[0][-1]]])
        else:
            _sources = ['/'.join([s.split('.')[1] if '.' in s else s for s in src[:-1]]) for src in sources]
            common_root = os.path.commonprefix(_sources)
            out = []
            for idx, src in enumerate(_sources):
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

