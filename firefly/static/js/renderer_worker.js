




var annotationsXHR;






	// we treat the value 1 specially, since it depends on zoom level
	// and we prefer it to be non-zero for evaluation in boolean contexts
	if (data.options.overlay_previous_period == 1) {
		data.offset = data.zoom
	} else {
		// this'll be null or some # of seconds
		data.offset = data.options.overlay_previous_period;
	}




	annotationsXHR && annotationsXHR.abort();




		previousXHR = fetchData(data.start - data.offset, data.end - data.offset);

	if (data.options.show_annotations) {
		annotationsXHR = fetchAnnotations(data.start, data.end);
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






function processData(currentData, previousData, annotationsData) {












			var layer = {};
			layer.data = []






					var under = layers[l-1].data[i];








				layer.data.push({"x": x, "y": y, "y0": y0});








	for (var i=0; i<currentLayers.length; i++) currentLayers[i].shift = 0;

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





		"offset"         : data.offset,




		"previousLayers" : previousLayers,
		"annotations"    : annotations


