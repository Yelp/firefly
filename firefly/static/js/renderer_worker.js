// a web worker for use by the renderer

var data;
var currentXHRs;
var previousXHRs;
var annotationsXHR;
var sourcesPerDataServer;

var NO_DATA_FOR_TIMESTAMP = "nodata";

self.onmessage = function(evt) {
	data = evt.data;
	data.end = Math.floor(Date.now() / 1000);
	data.start = data.end - data.zoom;

	// we treat the value 1 specially, since it depends on zoom level
	// and we prefer it to be non-zero for evaluation in boolean contexts
	if (data.options.overlay_previous_period == 1) {
		data.offset = data.zoom;
	} else {
		// this'll be null or some # of seconds
		data.offset = data.options.overlay_previous_period;
	}

	var i = 0;
	// cancel any ongoing requests
	if (currentXHRs) {
		for (i = 0; i < currentXHRs.length; i++) {
			currentXHRs[i].abort();
		}
	}
	if (previousXHRs) {
		for (i=0; i < previousXHRs.length; i++) {
			previousXHRs[i].abort();
		}
	}
	currentXHRs = {};
	previousXHRs = {};
	annotationsXHR && annotationsXHR.abort();

	sourcesPerDataServer = {};

	var dataServer;

	for (var sourceIndex = 0; sourceIndex < data.sources.length; sourceIndex++) {
		var source = data.sources[sourceIndex];
		dataServer = source[0];
		if (!sourcesPerDataServer[dataServer]) {
			sourcesPerDataServer[dataServer] = {};
		}
		sourcesPerDataServer[dataServer][sourceIndex] = source;
	}

	for (dataServer in sourcesPerDataServer) {
		var dataServerSources = [];
		var sortedDataServerPosKeys = Object.keys(sourcesPerDataServer[dataServer]).sort();
		for (var _posKey = 0; _posKey < sortedDataServerPosKeys.length; _posKey++) {
			var posKey = sortedDataServerPosKeys[_posKey];
			dataServerSources.push(sourcesPerDataServer[dataServer][posKey]);
		}
		// start our new request(s)
		currentXHRs[dataServer] = fetchData(dataServer, dataServerSources, data.start, data.end);
		if (data.options.overlay_previous_period) {
			previousXHRs[dataServer] = fetchData(dataServer, dataServerSources, data.start - data.offset, data.end - data.offset);
		}
	}
	if (data.options.show_annotations) {
		// TODO (fhats): Pull annotations from all the different data servers, not just one
		// TODO (fhats): Annotations shouldn't require any knowledge of the sources.
		annotationsXHR = fetchAnnotations(data.sources[0][0], data.sources, data.start, data.end);
	}
};

function fetchData(dataServer, sources, start, end) {
	var xhr = new XMLHttpRequest();
	var url = dataServer + "/data?" +
		"sources=" + encodeURIComponent(JSON.stringify(sources.map(function (x){ return x.slice(1); }))) +
		"&start="  + (start - 60) + // buffer for one minute
		"&end="    + end +
		"&width="  + data.width +
		"&token="  + data.token;

	xhr.open("GET", url, true);
	xhr.onreadystatechange = handleResponse;
	xhr.send(null);
	return xhr;
}

function fetchAnnotations(dataServer, sources, start, end) {
	var xhr = new XMLHttpRequest();
	var url = dataServer + "/annotations?" +
		"sources=" + encodeURIComponent(JSON.stringify(sources.map(function (x){ return x.slice(1); }))) +
		"&start="  + (start - 60) + // buffer for one minute
		"&end="    + end +
		"&width="  + data.width +
		"&token="  + data.token;

	xhr.open("GET", url, true);
	xhr.onreadystatechange = handleResponse;
	xhr.send(null);
	return xhr;
}

/**
 * Tells authoritatively whether or not all outstanding XHRs are complete.
 */
function allXHRsComplete() {
	var src;
	var xhr;
	for (src in currentXHRs) {
		xhr = currentXHRs[src];
		if (xhr.readyState !== 4) return false;
	}
	for (src in previousXHRs) {
		xhr = currentXHRs[src];
		if (xhr.readyState !== 4) return false;
	}
	if (data.options.show_annotations && annotationsXHR && annotationsXHR.readyState !== 4) return false;

	return true;
}

/**
 * Tests to see if any failures (non-200 HTTP status) occurred in the object
 * that has XHRs in it.
 */
function anyXHRFailures(xhrObject) {
	var xhr;
	var src;
	for (src in xhrObject) {
		xhr = xhrObject[src];
		if (xhr.readyState === 4 && xhr.status !== 200) {
			return true;
		}
	}
	return false;
}

function anyXHRsAborted(xhrObject) {
	var xhr;
	var src;
	for (src in xhrObject) {
		xhr = xhrObject[src];
		if (xhr.readyState === 4 && xhr.status === 0) {
			return true;
		}
	}
	return false;
}

/**
 * Creates a placeholder array full of sentinels that indicate
 * the data source had no data for a time stamp, rather than
 * the data server returning null for that timestamp.
 */
function makeNoDataArray(size) {
	var arr = [];
	for (var i = 0; i < size; i++) {
		arr.push(NO_DATA_FOR_TIMESTAMP);
	}
	return arr;
}

function dataObjFromXHRs(xhrs) {
	var dataServer;
	var response;
	var parsedData = {};
	for (dataServer in xhrs) {
		response = JSON.parse(xhrs[dataServer].responseText);
		for (var pointIdx = 0; pointIdx < response.length; pointIdx++) {
			var point = response[pointIdx];
			parsedData[point.t] = parsedData[point.t] || makeNoDataArray(data.sources.length);
			for (var posIdx = 0; posIdx < point.v.length; posIdx++) {
				var originalPosition = Object.keys(sourcesPerDataServer[dataServer]).sort()[posIdx];
				parsedData[point.t][originalPosition] = point.v[posIdx];
			}
		}
	}

	return objectToDataList(parsedData);
}


/**
 * Takes an object with keys as timestamp values and values as arrays of data
 * points and turns it into an array of objects with keys 't' and 'v'.
 */
function objectToDataList(dataObject) {
	var massagedData = [];
	for (var t in dataObject) {
		massagedData.push({
			't': t,
			'v': dataObject[t]
		});
	}
	return massagedData;
}

function handleResponse() {
	// handleResponse will get called again if any of our outstanding XHRs are
	// not yet complete.
	if (!allXHRsComplete()) return;

	if (anyXHRsAborted(currentXHRs) || anyXHRsAborted(previousXHRs)) return;

	// make sure no errors happened
	if (anyXHRFailures(currentXHRs) || anyXHRFailures(previousXHRs)) {
		throw "Error: non-200 status received";
	}

	// otherwise let's process our incoming data
	var currentData = [];
	var previousData = [];
	var annotationsData = [];

	currentData = dataObjFromXHRs(currentXHRs);
	if (data.options.overlay_previous_period) {
		previousData = dataObjFromXHRs(previousXHRs);
	}
	if (data.options.show_annotations && annotationsXHR) {
		try {
			annotationsData = JSON.parse(annotationsXHR.responseText);
		} catch (err) {
			// Sometimes annotations don't come back as '[]' when empty.
			// I'm not sure why.
			// Let's just assume there's nothing to show.
			annotationsData = [];
		}
	}

	processData(currentData, previousData, annotationsData);
}

function processData(currentData, previousData, annotationsData) {
	var stackLayers = data.options.stacked_graph;
	var layerCount = data.sources.length;

	// keep track of the global max and min
	var max = -Infinity, min = Infinity;

	// transform the data into d3's layer format,
	// and optionally stack the layers
	function extractLayers(data) {
		var layers = [];
		var alpha = 8 / Math.pow(10, self.data.options.smooth_alpha/100);

		for (var l=0; l<layerCount; l++) {
			var layer = {};
			layer.data = [];

			for (var i=0; i<data.length; i++) {
				// If the data server had no data for this timestamp (rather
				// than having NULL for this timestamp), we should just skip
				// it.
				if (data[i].v[l] === NO_DATA_FOR_TIMESTAMP) continue;
				var x = data[i].t * 1000;
				var y = data[i].v[l];
				if (self.data.options.smooth && i > 0 && y !== null) {
					y = layer.data[i-1].y + alpha * (data[i].v[l] - layer.data[i-1].y);
				}

				if (l > 0 && stackLayers) {
					var under = layers[l-1].data[i];
					var y0 = under.y0 + under.y;
				} else {
					var y0 = 0;
				}

				var total = y + y0;
				max = Math.max(total, max);
				min = Math.min(total, min);
				layer.data.push({"x": x, "y": y, "y0": y0});
			}
			layers.push(layer);
		}

		return layers;
	}
	var currentLayers = extractLayers(currentData);
	for (var i=0; i<currentLayers.length; i++) currentLayers[i].shift = 0;
	var previousLayers = extractLayers(previousData);
	for (var i=0; i<previousLayers.length; i++) previousLayers[i].shift = data.offset * 1000;

	// restructure annotations so we have the correct types for all the data
	var annotations = [];
	for(var idx in annotationsData){
		annotations.push({
			id: parseInt(annotationsData[idx].id),
			type: annotationsData[idx].type,
			description: annotationsData[idx].description,
			time: parseFloat(annotationsData[idx].time) * 1000
		});
	}

	self.postMessage({
		"options"        : data.options,
		"start"          : data.start,
		"end"            : data.end,
		"offset"         : data.offset,
		"max"            : max,
		"min"            : min,
		"layerCount"     : layerCount,
		"currentLayers"  : currentLayers,
		"previousLayers" : previousLayers,
		"annotations"    : annotations
	});
}
