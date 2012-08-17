(function($){
	$.fn.inplace = function(options) {
		options = options || {};

		var save_new_data = function(input, container) {
			var newText = input.value;
			$(container).empty();
			container.innerText = newText;
			(options.onSave || function(){})(newText);
			$(container).one('click', OBSERVE_THE_CLICKING);
		};

		var OBSERVE_THE_CLICKING = function(evt) {
			var container = this;
			var input = document.createElement('input');
			input.value = container.innerText;
			$(input).css({'width': $(container).width() + 'px'});
			$(input).blur(function(evt) {
				save_new_data(input, container);
			});
			$(input).keypress(function(evt) {
				if (evt.keyCode == 13) {
					save_new_data(input, container);
				}
			});
			$(container).empty();
			$(container).append(input);
			$(input).focus();
		};

		return this.each(function() {
			$(this).one('click', OBSERVE_THE_CLICKING);
		});
	};
}(jQuery));
