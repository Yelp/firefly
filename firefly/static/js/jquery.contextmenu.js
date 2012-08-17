(function($) {

	var menuEl = null;

	var constructMenuDOM = function(menu, evt) {
		var ul = document.createElement('ul');
		ul.className = "contextmenu";

		if (menu.constructor === Function.prototype.constructor) {
			var items = menu.apply(evt.target, [evt]);
		} else {
			var items = menu;
		}

		for (var i=0; i<items.length; i++) {
			var item = items[i];
			var li = document.createElement('li');
			if (item.disabled) {
				var holder = $("<span class='disabled'>").get(0);
			} else if (item.header) {
				var holder = $("<span class='header'>").get(0);
			} else {
				var holder = $("<a>").get(0);
			}
			holder.innerHTML = item.label;
			$(holder).attr(item.attrs);
			if (item.action) {
				$(holder).click(item.action);
			}
			if (item.children) {
				var evtHandlerFactory = function(children) {
					return function(evt) {
						showSubMenu.apply(this, [children, evt]);
					}
				};






				});

			}
			li.appendChild(holder);
			ul.appendChild(li);
		}

		return ul;

	};


		var ul = constructMenuDOM(menu, evt);
		var parentMenu = $(this).closest('ul');

		var thisPos = $(this).position();



		$(ul).css({
			'left': thisPos.left + $(parentMenu).width() + 'px',


	};






		menuEl = ul;




















		$(menuEl).click(function(evt) {

		});
		
	};


		$(menuEl).remove();
		menuEl = null;
	};
	
	$.fn.contextmenu = function(options) {
		options = options || {};
		return this.each(function() {





				}




				showMenu(options.menu, evt);
				return false;
			});














		});
	};
}(jQuery));
