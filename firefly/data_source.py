import colorsys
import logging


class DataSource(object):
    """Base class for Firefly Data Sources"""

    DESC = "Base class for Firefly Data Sources"

    path_splitter = "."

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
            return self._svc(unique_suffixes(sources, splitter=self.path_splitter))

    def title(self, sources):
        if len(sources) == 1:
            return map(lambda src: _maybe_right_split(src, self.path_splitter), sources[0][:-1])
        else:
            thing = common_source_prefix(sources, splitter=self.path_splitter)
            return thing


def common_source_prefix(sources, splitter="."):
    common_prefix = []

    for source_step in zip(*sources):
        # For each component in each source at the same position,
        # make sure the components are the same.
        # If they are, add it to the common prefix.
        # If not, we're done.
        source_step = map(lambda x: _maybe_right_split(x, splitter), source_step)
        if len(set(source_step)) == 1:
            common_prefix.append(source_step[0])
        else:
            break

    return common_prefix


def _maybe_right_split(s, splitter):
    if splitter and splitter in s:
        return s.split(splitter)[1]
    else:
        return s


def unique_suffixes(sources, splitter="."):
    common_prefix = common_source_prefix(sources, splitter="")
    prefix_len = len(common_prefix)

    suffixes = [source[prefix_len:] for source in sources]
    return [map(lambda x: _maybe_right_split(x, splitter), suffix)
        for suffix in suffixes]
