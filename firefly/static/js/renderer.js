goog.provide("firefly.Renderer");

goog.require('goog.debug.Logger');


/**
 * @constructor
 */
firefly.Renderer = function(graph, makeURL, dataServer, container, titleEl, legendEl, containerHeight) {
	this.makeURL_ = makeURL;
	this.graph_ = graph;
	this.dataServer = dataServer;
	this.container = container;
	this.legendEl = legendEl;
	this.titleEl = titleEl;
	this.containerHeight_ = containerHeight;

	// create the tooltip element, which we'll use on mouseover
	// to show data point details
	var tooltip = d3.select(this.container).append('div')
		.attr('class', 'guide-tooltip')
		.style('visibility', 'hidden');
	var table = tooltip.append('table');
	table.append('tbody');
	this.tooltip_ = tooltip[0][0];

	// a web worker to do our background processing
	this.worker = new Worker(this.makeURL_("static/js/renderer_worker.js"));
	this.worker.onmessage = $.proxy(function(evt) {
		d3.select(this.container).style("opacity", 1.0);
		this._redraw(evt.data);
	}, this);
	this.worker.onerror = $.proxy(function(evt) {
		d3.select(this.container).style("opacity", 0.2);
	}, this);

	// initialize the root svg and its various subgroups
	this._createSVG();

	// trigger the drawing of the axes
	this.resize();
};


firefly.Renderer.prototype.longDateFormatter_ = d3.time.format("%a %Y-%m-%d %H:%M");
firefly.Renderer.prototype.shortDateFormatter_ = d3.time.format("%H:%M");


firefly.Renderer.prototype.cleanup = function() {
	// this seems to be necessary to prevent chrome from
	// getting its workers all messed up
	this.worker.terminate();
};

/**
 * Draws the root svg element and sets up the svg:g groups to contain
 * the axes, lines, areas, guides, etc.  Creates the line and area
 * d3.interpolators.  Also creates the onmouseover listener on the root
 * svg to allow us to show/hide the guidelines/data tooltip.
 */
firefly.Renderer.prototype._createSVG = function() {
	var renderer = this;

	// margins between the main graph body and the edges of the svg element.
	// required to leave room for the axis text
	this.margins = {"top": 10, "right": 48, "bottom": 20, "left": 10};

	// our scales and axes (yScale varies on each redraw())
	this.xScale = d3.time.scale();
	this.xAxis = d3.svg.axis().orient("bottom").scale(this.xScale).tickSubdivide(true).tickPadding(6);
	this.yAxis = d3.svg.axis().orient("right");

	// check for null data
	checkDiscontinuous = function(d) {return d.y !== null;}

	// custom interpolator for single points
	interpol = function(points) { 
		//This is a simple linear interpolator except when there are isolated points.
		//When this is the case, we draw a short "line" 0.2 px to the side of the original
		//in order to form a point.  This allows for drawing something like a scatter plot.
		if (points.length == 1) {
			points.push([points[0][0] + 0.2, points[0][1]]);
		} 
		return points.join("L");
	}

	// helpers for drawing our lines/areas
	this.line = d3.svg.line().defined(checkDiscontinuous).interpolate(interpol); // use our custom interpolation for lines
	this.previousLine = d3.svg.line().defined(checkDiscontinuous).interpolate(interpol);
	this.area = d3.svg.area().interpolate("linear"); // and linear interpolation for areas

	// interpolator to figure out an index-to-color mapping
	this.hsl = d3.interpolateHsl("hsl(0, 95%, 50%)", "hsl(360, 95%, 50%)");
	this.annotation_line = d3.svg.area().defined(checkDiscontinuous).interpolate("linear");

	// our svg root and the root transform
	var svg = d3.select(this.container).append("svg:svg");
	this.svg = svg;
	var g = svg.append("svg:g").attr("transform", "translate(" + this.margins.left + "," + this.margins.top + ")");

	// a bunch of groups to hold our various objects
	g.append("svg:g").attr("class", "y axis");
	g.append("svg:g").attr("class", "x axis");
	g.append("svg:g").attr("class", "lines");
	g.append("svg:g").attr("class", "prev-lines");
	g.append("svg:g").attr("class", "areas");
	g.append("svg:g").attr("class", "guide-dots");
	g.append("svg:g").attr("class", "annotations");

	var guideGroup = g.append('svg:g');
	this.guideLine_ = guideGroup.append('svg:line')
		.attr('class', 'guide-line')
		.attr('y1', 0)
		.attr('y2', this.height)
		.style('visibility', 'hidden');
};


/**
 * Makes the guideline/guidedots/tooltip visible and sets up the mousemove
 * listener so we can reposition/repopulate them as we mouse over the graph.
 */
firefly.Renderer.prototype.showGuide = function() {
	// put the guide where it's supposed to go
	this.positionGuide();

	// then make it visible
	this.guideLine_
		.attr('y2', this.height)
		.style('visibility', 'visible');

	this.svg.select('.guide-dots').selectAll('circle')
		.style('visibility', 'visible');

	d3.select(this.tooltip_).style('visibility', 'visible');

	// then start watching for mousemoves
	this.svg.on('mousemove', $.proxy(this.positionGuide, this));
};


/**
 * Makes the guideline/guidedots/tooltip invisible and cleans up
 * our mouse listeners so we're ready for the next mouseover.
 */
firefly.Renderer.prototype.hideGuide = function() {
	// hide some things
	this.guideLine_.style('visibility', 'hidden');
	d3.select(this.tooltip_).style('visibility', 'hidden');
	this.svg.select('.guide-dots').selectAll('circle')
		.style('visibility', 'hidden');

	// stop listening to some things
	this.svg.on('mousemove', null);
};


/**
 * Position the guideline/guidedots/tooltip and fill the tooltip values appropriately;
 * called on mousemove. This uses a getDataCoords helper algorithm to figure out where
 * to put the dots.
 */
firefly.Renderer.prototype.positionGuide = function() {
	// get mouse coordinates relative to the container object
	var mouseCoords = d3.mouse(this.container, d3.event);

	// position the guideline right at the mouse
	this.guideLine_
		.attr('x1', mouseCoords[0])
		.attr('x2', mouseCoords[0]);

	// convert mouse coordinates to time according to primary X scale
	var timeAtMouseX = this.xScale.invert(mouseCoords[0]);

	// get the pixel coords and y-scale values for the 'current' data lines
	var currentDataPoints = this.getDataCoords_(
		this.lastData.currentLayers,
		this.lastData.currentLayersXAxes,
		timeAtMouseX);

	var allDataPoints = currentDataPoints;

	// get the pixel coords and y-scale values for the 'previous' data lines
	if (this.lastData.options.overlay_previous_period) {
		var lastDataPoints = this.getDataCoords_(
			this.lastData.previousLayers,
			this.lastData.previousLayersXAxes,
			timeAtMouseX);

		// TODO(bigo|2012-03-12): is there a more efficient array interleave we can do here?
		var combinedDataPoints = [];
		for (var i=0; i < currentDataPoints.length; i++) {
			combinedDataPoints.push(currentDataPoints[i]);
			combinedDataPoints.push(lastDataPoints[i]);
		}

		allDataPoints = combinedDataPoints;
	}

	// set the guidedots to their proper x,y pixel coords
	this.svg.select('.guide-dots').selectAll('circle')
		.data(allDataPoints)
		.attr('cx', function(d) { return d.dotX; })
		.attr('cy', function(d) { return d.dotY; });

	// tooltip: fill in current values from guidedots
	var renderer = this;
	d3.select(this.tooltip_).selectAll('td.value')
		.data(allDataPoints)
		.text(function(d, i) {
			var isSameDate = (d.date.getFullYear() == renderer.lastUpdateTime_.getFullYear() &&
				d.date.getMonth() == renderer.lastUpdateTime_.getMonth() &&
				d.date.getDate() == renderer.lastUpdateTime_.getDate());
			if (isSameDate) {
				return d.value + ' @ ' + renderer.shortDateFormatter_(d.date);
			} else {
				return d.value + ' @ ' + renderer.longDateFormatter_(d.date);
			}
		});

	// tooltip: position it by the mouse
	d3.select(this.tooltip_)
		.style('top', mouseCoords[1] + 'px')
		.style('left', mouseCoords[0] + 20 + 'px');
};


/**
 * This gets passed a layer set (currentLayers or previousLayers) and
 * a corrollary set of 'axes', which are just flat arrays of the x-axis values
 * for the related layers eg/
 *  layers[0] = {data: [{x: 1, y:5}, {x:2, y:4}, {x:3, y:5}]}
 *  axes[0] = [1,2,3]
 * The only reason for 'axes' is that d3.bisect only works on flat arrays; if it took
 * an accessor function axes wouldn't be needed.
 *
 * Anyway, this is basically:
 *  - figure out the mouse coordinates (done above)
 *  - figure out the time at those coordinates, based on the primary X scale (also above)
 *  - figure out the "local" time for this layer (depends whether the layer is historical)
 *  - d3.bisect to find the closest /actual/ data point in our series
 *  - use the primary X scale to find the pixel coords for that point
 *  - use the Y scale to find the pixel coords for that point
 *  - push all that onto a list, which we'll use to update the locations of the
 *    guidedots and the values printed in the tooltip.
 */
firefly.Renderer.prototype.getDataCoords_ = function(layers, axes, timeAtMouseX) {
	var dataPoints = [];

	for (var i=0; i < layers.length; i++) {
		var layer = layers[i];
		if (layer.length == 0) {
			continue;
		}

		var localTimeAtMouseX = timeAtMouseX - layer.shift;
		var layerTimeStamps = axes[i];

		// find the closest actual reported data point to the mouse's
		// position on the x; bisect first to find the closest point on or to
		// the right of the mouse, then check the data point to the left in case
		// that's actually closer.
		var closestDataIndexToTime = d3.bisectLeft(layerTimeStamps, localTimeAtMouseX);
		var maxIndex = layer.data.length - 1;
		if (closestDataIndexToTime > maxIndex) {
			closestDataIndexToTime = maxIndex;
		}

		var thisPoint = layer.data[closestDataIndexToTime];
		if (closestDataIndexToTime > 0) {
			var lastPoint = layer.data[closestDataIndexToTime - 1];
			if (Math.abs(thisPoint.x - localTimeAtMouseX) > Math.abs(lastPoint.x - localTimeAtMouseX)) {
				closestDataIndexToTime -= 1;
			}
		}

		// then translate that to a pixel coord by looking it up
		// and getting the x value.
		var closestPoint = layer.data[closestDataIndexToTime];
		var closestDataPointX = this.xScale(closestPoint.x + layer.shift);

		var dotX = dotY = null;
		var yVal = (closestPoint.y + closestPoint.y0).toFixed(3);
		if (closestPoint.y !== null) {
			dotX = closestDataPointX;
			dotY = this.yScale(yVal);
		}
		else {
			yVal = 'undef';
			dotX = dotY = -20; // Move display off of the graph
		}
		dataPoints.push({
			'dotX': dotX,
			'dotY': dotY,
			'date': new Date(closestPoint.x),
			'value': yVal
		});

	}
	return dataPoints;
};


/**
 * informs the renderer of the height of its container, so it can size
 * the graph appropriately (note that the graph will have the legend's
 * height subtracted from its own).
 */
firefly.Renderer.prototype.setContainerHeight_ = function(height) {
	this.containerHeight_ = height;
};


/**
 * Called on resize, resets various widths and heights necessary for proper calculations.
 */
firefly.Renderer.prototype.resize = function() {
	// the -2 pixels there is for the borders on the table cells
	this.width = $(this.container).width() - this.margins.right - this.margins.left - 2;

	// TODO(bigo): Law of Demeter violation here in having to access the parent of the legendEl
	var legendEl = $(this.legendEl).closest('.graph-legend-container');
	this.height = this.containerHeight_ -
		this.margins.top -
		this.margins.bottom -
		legendEl.outerHeight() -
		// two pixels for the borders on the table cells
		2;

	this.xScale.range([0, this.width]);
	this.xAxis.ticks(this.width / 85).tickSize(-this.height, 0);
	this.yAxis.ticks(this.height / 40).tickSize(-this.width, 0);

	this.svg
		.attr('width', this.width + this.margins.right + this.margins.left)
		.attr('height', this.height + this.margins.top + this.margins.bottom);

	var div = d3.select(this.container);
	div.select(".x.axis")
		.attr("transform", "translate(0," + this.height + ")");
	div.select(".y.axis")
		.attr("transform", "translate(" + this.width + ",0)");
	div.select("rect")
		.attr("width", this.width)
		.attr("height", this.height);

	if (this.lastData) {
		this._redraw(this.lastData);
	}
};


firefly.Renderer.prototype.render = function (sources, zoom, options) {
	options = options || {};
	zoom = parseInt(zoom);
	// tell our worker to retrieve and process the data
	this.worker.postMessage({
		"sources"    : sources,
		"zoom"       : zoom,
		"options"    : options,
		"dataServer" : this.dataServer,
		"width"      : this.width,
		"token"      : this.graph_.sourcerer.getToken()
	});
};


/**
 * Called by the web worker thread to update the document with new data
 */
firefly.Renderer.prototype._redraw = function (data) {
	this.lastUpdateTime_ = new Date();
	var div = d3.select(this.container)
	var that = this;
	this.lastData = data;
	this.lastOptions_ = data.options;

	this.lastData.currentLayersXAxes = [];
	for (var j=0; j < data.currentLayers.length; j++) {
		var sub = [];
		for (var i=0;i<data.currentLayers[j].data.length;i++){
			sub.push(data.currentLayers[j].data[i].x);
		}
		this.lastData.currentLayersXAxes.push(sub);
	}

	this.lastData.previousLayersXAxes = [];
	for (var j=0; j < data.previousLayers.length; j++) {
		var sub = [];
		for (var i=0;i<data.previousLayers[j].data.length;i++){
			sub.push(data.previousLayers[j].data[i].x);
		}
		this.lastData.previousLayersXAxes.push(sub);
	}

	// render annotations first so that we don't end up trampling real data
	if(data.options.show_annotations){
		// draw the annotation lines
		var annotations = div.select(".annotations").selectAll(".annotation").data(data.annotations);
		annotations.enter().append("svg:line").attr("class", "annotation").attr('data-id', function(d){ return d.id; });
		annotations.exit().remove();

		// and now draw the annotation tooltips
		var annotation_tooltips = div.selectAll(".annotation-tooltip").data(data.annotations);
		annotation_tooltips.enter()
			.append("div")
				.attr('class', 'annotation-tooltip')
				.attr('data-id', function(d){ return d.id; })
			.append("table")
			.append("tbody")
			.append("td")
				.attr('class', 'annotation-tooltip-value')
				.attr('title', function(d){ return d.description; });
		annotation_tooltips.exit().remove();
	}
	else{
		div.selectAll(".annotation").remove();
		div.selectAll(".annotation-tooltip").remove();
	}

	// add/remove lines and areas as necessary
	var lines = div.select(".lines").selectAll("path").data(d3.range(data.layerCount));
	lines.enter().append("svg:path").attr("class", "current line");
	lines.exit().remove();

	if (data.options.overlay_previous_period) {
		var prev = div.select(".prev-lines").selectAll("path").data(d3.range(data.layerCount));
		prev.enter().append("svg:path").attr("class", "previous line");
		prev.exit().remove();
	} else {
		div.selectAll(".previous").remove();
	}
	if (data.options.area_graph) {
		var areas = div.select(".areas").selectAll("path").data(d3.range(data.layerCount));
		areas.enter().append("svg:path").attr("class", "area");
		areas.exit().remove();
	} else {
		div.selectAll(".area").remove();
	}
	div.selectAll(".line").style("stroke", function(d) { return that.hsl(d / data.layerCount); });
	div.selectAll(".area").style("fill", function(d) { return that.hsl(d / data.layerCount); });

	if (data.options.show_annotations && this.hasAnnotations) {
		this.drawAnnotations(div, data);
	}

	// if we had data before, first draw the new data on the old scales
	// this will allow us to animate the transition to the new scales -
	// a nice visual indicator that things have changed
	if (this.hasData) {
		div.selectAll(".line.current").attr("d", function(d) { return that.line(data.currentLayers[d].data); });
		div.selectAll(".line.previous").attr("d", function(d) { return that.previousLine(data.previousLayers[d].data); });
		div.selectAll(".area").attr("d", function(d) { return that.area(data.currentLayers[d].data); });
	}

	// prepare the scales
	if (data.options.y_axis_log_scale) {
		var max = Math.max(1e-6, data.max);
		var min = Math.max(1e-6, data.min);
		this.yScale = d3.scale.log()
			.clamp(true)
			.domain([min, data.options.y_axis_clamp || max])
			.nice()
			.range([this.height, 0]);
	} else {
		var max = Math.max(0, data.max);
		var min = Math.min(0, data.min);
		this.yScale = d3.scale.linear()
			.clamp(!!data.options.y_axis_clamp)
			.domain([min, data.options.y_axis_clamp || max])
			.nice()
			.range([this.height, 0]);
	}
	var tickFormat = data.options.y_axis_log_scale ?
		this.yScale.tickFormat() :
		this._linearTickFormat(this.yScale.domain(), this.yAxis.ticks()[0]);
	this.yAxis.scale(this.yScale).tickFormat(tickFormat);
	this.xScale.domain([data.start * 1000, data.end * 1000]);

	// draw the guide-line, dots and tooltip
	this.redrawGuides_(data);

	// prepare the line and area generators.
	var transition = div.transition().duration(0);

	if (data.options.show_annotations){
		this.drawAnnotations(div, data);
	}

	this.line
		.x(function(d) { return that.xScale(d.x); })
		.y(function(d) {
			if (d.y !== null) {
				return that.yScale(d.y + d.y0);
			}
			else {
				// The discontinuous line interpolator will handle the null case
				// by simply showing a discontinuity, rather than forcing the line
				// to zero for null data (the drop-off-the-end-of-the-world-effect).
				// Note that passing null to that.yScale will also cause y to come up
				// as 0 instead of letting the discontinuous interpolator deal with the
				// null case.
				return d.y;
			}
		});

	transition.selectAll(".line.current").attr("d", function(d) { return that.line(data.currentLayers[d].data); });

	if (data.options.overlay_previous_period) {
		var shift = data.offset * 1000;
		this.previousLine
			.x(function(d) { return that.xScale(d.x + shift); })
			.y(function(d) {
				if (d.y !== null) {
					return that.yScale(d.y + d.y0);
				}
				else {
					// See notes in the current data line generator regarding
					// nulls here
					return d.y;
				}
			});
		transition.selectAll(".line.previous").attr("d", function(d) { return that.previousLine(data.previousLayers[d].data); });
	}

	if (data.options.area_graph) {
		this.area
			.x(function(d)  { return that.xScale(d.x); })
			.y0(function(d) { return that.yScale(d.y0); })
			.y1(function(d) { return that.yScale(d.y + d.y0); });
		transition.selectAll(".area").attr("d", function(d) { return that.area(data.currentLayers[d].data); });
	}

	// draw the data on the new scales
	transition.select(".y.axis").call(this.yAxis);
	transition.select(".x.axis").call(this.xAxis)

	// remember if we had any data
	var hadData = !!this.hasData;
	this.hasData = !!(data.currentLayers[0].data.length || data.previousLayers[0].data.length);
	if (!hadData && this.hasData) {
		this.svg.on('mouseover', $.proxy(this.showGuide, this));
		this.svg.on('mouseout', $.proxy(this.hideGuide, this));
	} else if (hadData && !this.hasData) {
		this.svg.on('mouseover', null);
		this.svg.on('mouseout', null);
		this.hideGuide();
	}
	this.hasAnnotations = !!(data.annotations.length);

	if (data.options.smooth) {
		$(this.titleEl).addClass('smoothed');
	}
};


/**
 * ensure we have drawn the correct guide dots on the svg (one per line)
 * and have the correct rows in the tooltip (one per data source)
 */
firefly.Renderer.prototype.redrawGuides_ = function(data) {
	var div = d3.select(this.container);
	var renderer = this;

	var totalLayerCount = data.options.overlay_previous_period ? data.layerCount * 2 : data.layerCount;
	var rowRange = [];
	for (var i=0; i < data.layerCount; i++) {
		rowRange.push({'idx': i, 'overlay': false});
		if (data.options.overlay_previous_period) rowRange.push({'idx': i, 'overlay': true});
	}

	var rowToColor = function(d, i) {
		var color = renderer.hsl(d.idx / data.layerCount);
		if (d.overlay) {
			return d3.hsl(color).brighter(1.2);
		} else {
			return color;
		}
	};

	var guideDots = div.select('.guide-dots').selectAll('circle').data(rowRange)
		.enter()
			.append('svg:circle')
			.attr('r', 4)
			.style('fill', rowToColor)
			.style('visibility', 'hidden');

	var rows = d3.select(this.tooltip_).select('tbody').selectAll('tr')
		.data(rowRange);
	rows.enter().append('tr');
	rows.exit().remove();

	// draw a nice colored circle.
	var swatchCells = rows.selectAll('td.swatch')
		.data(function(row) {return [row]})
		.enter()
			.append('td')
				.attr('class', 'swatch')
				.append('svg:svg')
					.append('svg:g')
						.append('svg:circle')
							.attr('r', 5)
							.attr('cx', 5)
							.attr('cy', 5)
							.attr('fill', rowToColor);

	var countCells = rows.selectAll('td.value')
		.data(function(row) {return [row]})
		.enter()
			.append('td')
				.attr('class', function(d) {
					return d.overlay ? 'value historical' : 'value';
				});
};


/**
 * Does the legwork of drawing annotation lines and their corresponding tooltips.
 */
firefly.Renderer.prototype.drawAnnotations = function(div, data){
	var renderer = this;

	div.selectAll(".annotation")
		.attr("y1", 0)
		.attr("y2", this.height)
		.attr("x1", function(d){ return renderer.xScale(d.time); })
		.attr("x2", function(d){ return renderer.xScale(d.time); });

	div.selectAll(".annotation-tooltip-value")
		.text(function(d){
			var label = d.type;
			if (data.options.short_annotations) label = label.substring(0,1);
			return label;
		})

	div.selectAll(".annotation-tooltip")
		.style('top', function(d) { return (renderer._pickAnnotationToolTipLocation(d, this, data)[1]) + 'px'; })
		.style('left', function(d) { return (renderer._pickAnnotationToolTipLocation(d, this, data)[0]) + 'px'; });
};

/**
 * Picks a suitable location for the annotation tooltip
 *
 * placement occurs as follows:
 *     + first pick a side of the annotation line based on whether or not the tooltip would overflow
 *     + then get the tooltip out of the way of any conflicting data, if possible
 *     + then get the tooltip out of the way of any other tooltips that overlap
 */
firefly.Renderer.prototype._pickAnnotationToolTipLocation = function(annotation, tooltip, data) {
	var div = d3.select(this.container);

	// where the line for this annotation is
	var annotation_line_location = Math.floor(this.xScale(annotation.time));
	// tooltip width and height
	// we want what the browser has calculated here since the tooltip can be variable width
	var ttw = parseInt(tooltip.offsetWidth, 10);
	var tth = parseInt(tooltip.offsetHeight, 10);

	// proposed location
	var x = annotation_line_location;
	// we need to add in the position of the container because otherwise in views
	// where the graph container is offset (like Edit Graph) the tooltips will show outside
	// the graph area. most of the time this is zero
	var y = $(this.container).position().top + 25;

	var renderer = this;

	// a couple helpers for some geometry stuff
	var overlaps = function(x, y, w, h, other_x, other_y, other_w, other_h){
		/* Returns true or false indicating whether or not the box at
		 * (other_x, other_y) with width other_w and height other_h overlaps
		 * the box at (x,y) with width w and height h.
		 */
		return (x < other_x + other_w
			&& x+w > other_x
			&& y < other_y+other_h
			&& y+h > other_y);
	}

	/**
	 * Returns true if this tooltip box at (tt_x, tt_y) with width tt_w and height tt_h overlaps
	 * any other annotation tooltips; false otherwise.
	 *
	 * Note that this will only signal a conflict if this annotation's ID is higher than the
	 * annotations it is compared against. This helps reposition to be more stable be defining
	 * a kind of 'pecking order'.
	 */
	var conflicts_with_tooltips = function(tt_x, tt_y, tt_w, tt_h, annotation, data){
		var tts = div.selectAll('.annotation-tooltip')[0];
		// other tooltip boxes
		for (var idx in tts){
			var tt = tts[idx];
			var x_ = parseInt(tt.style.left, 10);
			var y_ = parseInt(tt.style.top, 10);
			var w_ = tt.offsetWidth;
			var h_ = tt.offsetHeight;
			var id = parseInt(tt.getAttribute('data-id'), 10);
			if(overlaps(tt_x,tt_y,tt_w,tt_h, x_, y_, w_, h_) && tooltip != tt && annotation.id > id) return true;
		}

		return false;
	}

	/**
	 * Returns true if the tooltip at (tt_x, tt_y) with width tt_w and height tt_h conflicts
	 * with any displayed graph data; false otherwise.
	 *
	 * Note that it is OK for tooltips to be inside area graphs. The condition this is designed
	 * to prevent is a tooltip obscuring the line formed by some data.
	 */
	var conflicts_with_graph_data = function(tt_x, tt_y, tt_w, tt_h, annotation, data){
		// some bound around where the tooltip is so we can have a little padding, preventing the tooltip
		// from being too close to data to obscure it, even if it doesn't technically overlap it
		var upper_tt_bound = tt_y - 10;
		var lower_tt_bound = tt_y + tt_h + 10;
		var left_tt_bound = tt_x - 5;
		var right_tt_bound = tt_x + tt_w + 5;

		var layer_set = [];
		layer_set.push(data.currentLayers);
		if (data.options.overlay_previous_period) {
			layer_set.push(data.previousLayers);
		}

		for (var layer_idx in layer_set) {
			for (var data_idx in layer_set[layer_idx]){
				// only look at the data in the appropriate region
				var layer = layer_set[layer_idx][data_idx].data;
				var shift = layer_set[layer_idx][data_idx].shift || 0;

				// create an array of x-values in this layer so that we can figure
				// out what segment of this layer we care about for this tooltip
				var times = layer.map(function(item){ return item.x + shift});
				var left_time = renderer.xScale.invert(left_tt_bound).getTime();
				var right_time = renderer.xScale.invert(right_tt_bound).getTime();

				// pull out the appropriate segment
				var left_element = d3.bisectLeft(times, left_time);
				var right_element = d3.bisectRight(times, right_time);
				var relevant_slice = layer.slice(left_element, right_element);

				// an uncomplicated way of tracking whether a line will be produced through the tt
				// less convoluted than trying to iterate pair-wise through the array
				// if both above and below are true, then there's data in the relevant slice that appears
				// both above and below the TT, meaning it will be drawn over
				var above = false;
				var below = false;

				for (var data_pt_idx in relevant_slice) {
					var data_pt = relevant_slice[data_pt_idx];
					// we care about the tooltip covering the lines, but not necessarily area
					// we don't examine y0 because it will be y in the preceding/following layers
					var data_y = renderer.yScale(data_pt.y);
					// if there's data within this tooltip, there's a conflict
					if (data_y >= upper_tt_bound && data_y <= lower_tt_bound) return true;

					if (data_y <= upper_tt_bound) above = true;
					if (data_y >= lower_tt_bound) below = true;
					// if we have data both above and below the tooltip, there has to be a point
					// at which a line passes through the tooltip, so there's a conflict.
					if (above && below) return true;
				}
			}
		}
		return false;
	}

	// flip the annotation tooltip if it would go off the graph
	if (x >= annotation_line_location && x+ttw > this.width) {
		x -= ttw;
	} else if (x < annotation_line_location && x < 0) {
		x += ttw;
	}

	// do a lookahead to see if we can safely position this below any conflicting graph lines
	// note that if we can't, we simply have to live with the fact that this tooltip could be in
	// the way of some data. it probably isn't wise to have annotations on in a configuration prone to that anyway
	var proposed_y = y;
	while (conflicts_with_graph_data(x, proposed_y, ttw, tth, annotation, data)) {
		if (proposed_y + tth > this.height) {
			// in this case we couldn't find any good place to put this tooltip that doesn't conflict with the displayed data
			// so we give up and return to the original y
			proposed_y = y;
			break;
		}
		else{
			// continue searching down the tooltip line for a good spot
			proposed_y += tth
		}
	}

	y = proposed_y;

	// move the tooltip down if it conflicts with any other tooltips displayed
	while (conflicts_with_tooltips(x, y, ttw, tth, annotation, data) && y + tth < this.height) {
		// allow for a little spacing between conflicting tooltips so that display doesn't feel totally cluttered
		y += tth + 3;
	}

	return [x,y];
};

firefly.Renderer.prototype._linearTickFormat = function(domain, count) {
	var prefix = d3.formatPrefix(Math.max(-domain[0], domain[1]));
	var scaledDomain = domain.map(function(n) { return prefix.scale(n); });
	var format = d3.scale.linear().domain(scaledDomain).tickFormat(count);

	return function(value) {
		if (value === 0) return "0";
		return format(prefix.scale(value)) + prefix.symbol;
	}
};

firefly.Renderer.prototype.legend = function(sources) {
	this.legendXHR && this.legendXHR.abort();
	this.legendXHR = $.ajax({
		url: this.dataServer + '/legend',
		dataType: 'json',
		data: {
			'sources': JSON.stringify(sources),
			'token'  : this.graph_.sourcerer.getToken()
		},
		context: this,
		success: function(data) {
			var that = this;
			var ul = $("<ul>");

			$.each(data['legend'], function(i, source) {
				var li = $("<li>").appendTo(ul);
				var div = $("<div>").addClass("color").appendTo(li);

				$(div).css("background-color", that.hsl(i / sources.length));
				$("<span>").html( source[0].join('&rarr;&#8203;') ).appendTo(li);
			});

			$(this.legendEl).empty().append(ul);
			this.resize();
		}
	});
};

firefly.Renderer.prototype.title = function(sources) {
	this.titleXHR && this.titleXHR.abort();
	this.titleXHR = $.ajax({
		url: this.dataServer + '/title',
		dataType: 'json',
		data: {
			'sources': JSON.stringify(sources),
			'token'  : this.graph_.sourcerer.getToken()
		},
		context: this,
		success: function(data) {
			$(this.titleEl).html( data['title'].join('&rarr;&#8203;'));
		}
	});
};
