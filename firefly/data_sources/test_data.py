import math

import firefly.data_source


class TestData(firefly.data_source.DataSource):
    DESC = "testing"

    def list_path(self, path):
        if not path:
            return [{'type': 'file', 'name': 'test-data-plain'},
                    {'type': 'file', 'name': 'test-data-moving'},
                    {'type': 'file', 'name': 'test-data-discontinuous'}]

    def graph(self):
        raise NotImplemented

    def data(self, sources, start, end, width):
        # TODO (bstack): This needs to be done in a more clever way
        span = end - start
        data = []
        sources = self._flat_sources(sources)
        for x in xrange(span):
            t = x + start
            val = []
            for source in sources:
                if source == 'test-data-plain':
                    val.append(math.sin(x*math.pi/(span/4)))
                if source == 'test-data-moving':
                    val.append(math.sin(t*math.pi/(span/4)))
                if source == 'test-data-discontinuous':
                    sine = math.sin(1+x*math.pi/(span/4))
                    if -0.3 < sine < 0.3:
                        disc = None
                    else:
                        disc = sine/2
                    val.append(disc)
            values_string = ",".join("%0.4f"%(v,) if v else "null" for v in val)
            data.append('{"t":%d,"v":[%s]}' % (t, values_string))
        return "[%s]" % ','.join(data)

    def legend(self, sources):
        sources = self._flat_sources(sources)
        titles = [[[source], "#ff0000"] for source in sources]
        return titles

    def _flat_sources(self, sources):
        flat_sources = []
        for slist in sources:
            flat_sources.extend(slist)
        return flat_sources

    def title(self, sources):
        return ["Test Data"]
