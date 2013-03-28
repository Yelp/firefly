// a web worker for use by the renderer

var data;
var currentXHRs;
var previousXHRs;
var annotationsXHR;
var sourcesPerDataServer;

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
	previousXHR = {};
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
		for (var _posKey = 0; _posKey < sortedDataServerPosKeys; _posKey++) {
			var posKey = sortedDataServerPosKeys[_posKey];
			dataServerSources.push(sourcesPerDataServer[dataServer][posKey]);
			if (!sourcesPerDataServer[dataServer][posKey]) throw JSON.stringify({data: posKey, ds:sourcesPerDataServer[dataServer]});
		}
		try {
			// start our new request(s)
			currentXHRs[dataServer] = fetchData(dataServer, dataServerSources, data.start, data.end);
			if (data.options.overlay_previous_period) {
				previousXHRs[dataServer] = fetchData(dataServer, dataServerSources, data.start - data.offset, data.end - data.offset);
			}
		} catch (err) {
			throw JSON.stringify({data: dataServerSources, x:sourcesPerDataServer[dataServer], a:dataServer});
		}
	}
	if (data.options.show_annotations) {
		annotationsXHR = fetchAnnotations(data.start, data.end);
	}

}

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

function fetchAnnotations(start, end) {
	var xhr = new XMLHttpRequest();
	var url = data.dataServer + "/annotations?" +
		"sources=" + encodeURIComponent(JSON.stringify(data.sources)) +
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
	if (data.options.show_annotations && annotationsXHR.readyState !== 4) return false;

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
		if (xhr.status !== 200) {
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
		if (xhr.status === 0) {
			return true;
		}
	}
	return false;
}

function makeNullArray(size) {
	var arr = [];
	for (var i = 0; i < size; i++) {
		arr.push(null);
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
			parsedData[point.t] = parsedData[point.t] || makeNullArray(data.sources.length);
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
		throw "Error: non-200 status received"
	}

	// otherwise let's process our incoming data
	var currentData = dataObjFromXHRs(currentXHRs);
	var previousData = []
	var annotationsData = [];

	processData(currentData, previousData, annotationsData);

	// if (data.options.show_annotations && annotationsXHR.status === 200) {
	// 	annotationsData = JSON.parse(annotationsXHR.reponseText);
	// }

	// if (!data.options.show_annotations || annotationsXHR.readyState === 4){
	// 	if (data.options.overlay_previous_period) {
	// 		if (currentXHR.readyState === 4 && previousXHR.readyState === 4) {
	// 			if (currentXHR.status === 200 && previousXHR.status === 200) {
	// 				var currentData = JSON.parse(currentXHR.responseText);
	// 				var previousData = JSON.parse(previousXHR.responseText);
	// 				var annotationsData = [];
	// 				if (data.options.show_annotations && annotationsXHR.status === 200){
	// 					annotationsData = JSON.parse(annotationsXHR.responseText);
	// 				}
	// 				processData(currentData, previousData, annotationsData);
	// 			} else {
	// 				// status code 0 means aborted
	// 				if (currentXHR.status > 0 || previousXHR.status > 0) {
	// 					throw "Error: received " + currentXHR.status + ", " + previousXHR.status;
	// 				}
	// 			}
	// 		}
	// 	} else {
	// 		if (currentXHR.readyState === 4) {
	// 			if (currentXHR.status === 200) {
	// 				var currentData = JSON.parse(currentXHR.responseText);
	// 				var annotationsData = [];
	// 				if (data.options.show_annotations && annotationsXHR.status === 200){
	// 					annotationsData = JSON.parse(annotationsXHR.responseText);
	// 				}
	// 				processData(currentData, [], annotationsData);
	// 			} else {
	// 				if (currentXHR.status > 0) {
	// 					throw "Error: received " + currentXHR.status;
	// 				}
	// 			}
	// 		}
	// 	}
	// }
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
	var annotations = []
	for(idx in annotationsData){
		annotations.push({
			id: parseInt(annotationsData[idx].id),
			type: annotationsData[idx].type,
			description: annotationsData[idx].description,
			time: parseFloat(annotationsData[idx].time) * 1000
		})
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
