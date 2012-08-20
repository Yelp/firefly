// a web worker for use by the renderer

var data;
var currentXHR;
var previousXHR;
var annotationsXHR;

self.onmessage = function(evt) {
	data = evt.data;
	data.end = Math.floor(Date.now() / 1000);
	data.start = data.end - data.zoom;

	// we treat the value 1 specially, since it depends on zoom level
	// and we prefer it to be non-zero for evaluation in boolean contexts
	if (data.options.overlay_previous_period == 1) {
		data.offset = data.zoom
	} else {
		// this'll be null or some # of seconds
		data.offset = data.options.overlay_previous_period;
	}

	// cancel any ongoing requests
	currentXHR && currentXHR.abort();
	previousXHR && previousXHR.abort();
	annotationsXHR && annotationsXHR.abort();

	// start our new request(s)
	currentXHR = fetchData(data.start, data.end);
	if (data.options.overlay_previous_period) {
		previousXHR = fetchData(data.start - data.offset, data.end - data.offset);
	}
	if (data.options.show_annotations) {
		annotationsXHR = fetchAnnotations(data.start, data.end);
	}
}

function fetchData(start, end) {
	var xhr = new XMLHttpRequest();
	var url = data.dataServer + "/data?" +
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
};

function handleResponse() {
	// handleResponse will get called again if the annotations XHR isn't ready and we want annotations data
	// therefore we can skip this.
	if (!data.options.show_annotations || annotationsXHR.readyState === 4){
		if (data.options.overlay_previous_period) {
			if (currentXHR.readyState === 4 && previousXHR.readyState === 4) {
				if (currentXHR.status === 200 && previousXHR.status === 200) {
					var currentData = JSON.parse(currentXHR.responseText);
					var previousData = JSON.parse(previousXHR.responseText);
					var annotationsData = [];
					if (data.options.show_annotations && annotationsXHR.status === 200){
						annotationsData = JSON.parse(annotationsXHR.responseText);
					}
					processData(currentData, previousData, annotationsData);
				} else {
					// status code 0 means aborted
					if (currentXHR.status > 0 || previousXHR.status > 0) {
						throw "Error: received " + currentXHR.status + ", " + previousXHR.status;
					}
				}
			}
		} else {
			if (currentXHR.readyState === 4) {
				if (currentXHR.status === 200) {
					var currentData = JSON.parse(currentXHR.responseText);
					var annotationsData = [];
					if (data.options.show_annotations && annotationsXHR.status === 200){
						annotationsData = JSON.parse(annotationsXHR.responseText);
					}
					processData(currentData, [], annotationsData);
				} else {
					if (currentXHR.status > 0) {
						throw "Error: received " + currentXHR.status;
					}
				}
			}
		}
	}
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
		var alpha = 8 / Math.pow(10, self.data.options.smooth_alpha);

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
