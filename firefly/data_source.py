import colorsys
import logging


class DataSource(object):
    """Base class for Firefly Data Sources"""

    DESC = "Base class for Firefly Data Sources"

    # path_splitter can be used to optionally pretty-up the components in
    # titles and legends. This was originally used by StatMonster but can be
    # adopted for other data source which might not have very 'clean' keys.
    path_splitter = "."

    def __init__(self, *args, **kwargs):
        self.logger = logging.getLogger(__name__)
        self.ui_exclude = bool(kwargs.get('ui_exclude', False))

    def list_path(self, path):
        """given an array of path components, list the (presumable) directory"""
        raise NotImplemented

    def graph(self):
        raise NotImplemented

    def data(self):
        raise NotImplemented

    def _svc(self, sources):
        """Given a set of sources, generates legend information for the sources.

        Legend information consists of a list of (source_list, #hexcolor) pairs
        which are passed to the client to display what color maps to what
        stat source.
        """
        colorstep = 1.0 / len(sources)
        svc = zip(sources, ("#%s" % ("%02x%02x%02x" % colorsys.hsv_to_rgb(i * colorstep, 1, 255)) for i in xrange(len(sources))))
        return svc

    def legend(self, sources):
        """Provides a default legend for a set of sources.

        Legends are sets of (source_list, #hexcolor) pairs. The helper method
        _svc is good at generating these. The legend produced by this default
        is:

        * If there's only one source, then the legend text is the last component
            of the source.
        * If there's more than once source, the legend text is the set of unique
            suffixes in the list of sources. So if there are three sources:
                ['a', 'b', 'c'], ['a', 'd', 'e'], and ['a', 'f', 'g']
            then the legend texts would be [['b', 'c'], ['d', 'e'], ['f', 'g']]

        Components of the legend are cleaned up according to self.path_splitter.
        See _maybe_right_split for more details.
        """
        if len(sources) == 1:
            return self._svc([[sources[0][-1]]])
        else:
            return self._svc(unique_suffixes(sources, splitter=self.path_splitter))

    def title(self, sources):
        """Provides a default title for a set of sources.

        Titles are just source components. This default sets the title to the
        common source component prefix; that is, if sources
            ['a', 'b', 'c'], ['a', 'b', 'd'], ['a', 'b', 'f']
        are provided, this will generate a title of
            ['a', 'b']

        The title components are cleaned up according to self.path_splitter.
        See _maybe_right_split for more details.
        """

        if len(sources) == 1:
            return map(lambda src: _maybe_right_split(src, self.path_splitter), sources[0][:-1])
        else:
            thing = common_source_prefix(sources, splitter=self.path_splitter)
            return thing


def common_source_prefix(sources, splitter="."):
    """Given a list of sources (where each source is a list itself),
    returns a list corresponding to the longest common prefix of source
    components.

    Each component in each source is filtered through a split on the string
    specified in splitter to 'clean up' source names. If splitter is set to
    a false-y value, no cleaning occurs.
    """
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
    """If we can, split the string `s` by `splitter` and take the right-hand
    component (the second item in the returned tuple).
    """
    if splitter and splitter in s:
        return s.split(splitter)[1]
    else:
        return s


def unique_suffixes(sources, splitter="."):
    """Generates a list of unique suffixes in the list of sources given by
    `sources`.

    Optionally cleans up each source component using `splitter` and
    `_maybe_right_split`.
    """
    common_prefix = common_source_prefix(sources, splitter="")
    prefix_len = len(common_prefix)

    suffixes = [source[prefix_len:] for source in sources]
    return [map(lambda x: _maybe_right_split(x, splitter), suffix)
        for suffix in suffixes]
