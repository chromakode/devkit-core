/**
 * @license
 * This file is part of the Game Closure SDK.
 *
 * The Game Closure SDK is free software: you can redistribute it and/or modify
 * it under the terms of the Mozilla Public License v. 2.0 as published by Mozilla.

 * The Game Closure SDK is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * Mozilla Public License v. 2.0 for more details.

 * You should have received a copy of the Mozilla Public License v. 2.0
 * along with the Game Closure SDK.  If not, see <http://mozilla.org/MPL/2.0/>.
 */

jsio.__env.fetch = function (filename) {
	return false;
};

import ..debugging.conn;
import device;

var isSimulator = GLOBAL.CONFIG && !!CONFIG.simulator;
var isNative = /^native/.test(CONFIG.target);

if (isSimulator) {
	// prefix filenames in the debugger
	jsio.__env.debugPath = function (path) { return 'http://' + (CONFIG.bundleID || CONFIG.packageName) + '/' + path.replace(/^[\.\/]+/, ''); }

	if (isNative) {
		import ..debugging.nativeShim;
	}
}

// shims

if (!window.JSON) {
	jsio('import std.JSON').createGlobal();
}

if (!window.console) {
	window.console = {};
	window.console.log = window.console.info = window.console.error = window.console.warn = function () {};
}

if (!window.localStorage) {
	window.localStorage = {
		getItem: function () {},
		setItem: function () {},
		removeItem: function () {}
	}
}

var splash = document.getElementById('_GCSplash');
if (splash) {
	if (!CONFIG.splash.hide) {
		CONFIG.splash.hide = function () {
				// timeout lengths are debateable. Perhaps they could
				// be configurable. On one hand these time out lengths increase
				// the length of time that nothing is happening. However, it also
				// makes the transition into the game much smoother. The initial timeout
				// is for images to pop in.
				setTimeout(function() {
					splash.style.opacity = 0;
					splash.style.pointerEvents = 'none';
					setTimeout(function() {
						splash.parentNode.removeChild(splash);
					}, 500);
				}, 100);
			};
	}
}

// parsing options
import std.uri;
var uri = new std.uri(window.location);
var mute = uri.hash('mute');
CONFIG.isMuted = mute != undefined && mute != "false" && mute != "0" && mute != "no";

if (DEBUG) {
	import ..debugging._DEBUG as _DEBUG;
	GLOBAL._DEBUG = new _DEBUG();


	var DEVICE_ID_KEY = '.devkit.deviceId';
	var deviceId;
	var deviceType;

	if (isSimulator) {
		deviceId = CONFIG.simulator.deviceId;
		deviceType = CONFIG.simulator.deviceType;

		// simulate device chrome, input, and userAgent
		var deviceType = uri.hash('deviceType');
		if (deviceType) {
			// hack to access SDK static resolutions file from a debug device
			try {
				import .simulateDevice;
				var xhr = new XMLHttpRequest();
				xhr.open('GET', '/simulate/static/util/resolutions.js', false);
				xhr.send();

				var resolutions = eval("(function () { exports = {}; " + xhr.responseText + "; return exports; })()");
				simulateDevice.simulate(resolutions.get(deviceType));
			} catch (e) {
				logger.error(e);
			}
		}

		// TODO: debugging conn should be fixed (missing socketio.js file)
		// and should be changed to handle the load failure
		debugging.conn.connect({
			handshake: {
				deviceId: deviceId,
				deviceType: deviceType,
				userAgent: navigator.userAgent,
				screen: {
					width: device.screen.width,
					height: device.screen.height
				}
			}
		}, function () { startApp(); });

	} else {
		deviceId = localStorage.getItem(DEVICE_ID_KEY);
		if (!deviceId) {
			import std.uuid;
			deviceId = std.uuid.uuid();
			localStorage.setItem(DEVICE_ID_KEY, deviceId);
		}

		if (device.isAndroid) {
			deviceType = 'browser-android';
		} else if (device.isIOS) {
			deviceType = 'browser-ios';
		} else {
			deviceType = 'browser-mobile';
		}

		// start app without debugging connection
		startApp();
	}

} else {
	startApp();
}

function startApp () {

	// setup timestep device API

	import device;
	import platforms.browser.initialize;
	device.init();

	// init sets up the GC object
	import devkit;

	if (debugging.conn.getClient) {
		import ..debugging.clients.viewInspector;
		import ..debugging.clients.simulator;

		debugging.clients.viewInspector.setConn(debugging.conn);
		debugging.clients.simulator.setConn(debugging.conn);

		if (CONFIG.splash) {
			var prevHide = CONFIG.splash.hide;
			var client = debugging.conn.getClient('simulator');
			CONFIG.splash.hide = function () {
				prevHide && prevHide.apply(this, arguments);
				client.onConnect(function () {
						client.sendEvent('HIDE_LOADING_IMAGE');
					});
			};
		}

		var initDebugging = function () {
			var env = jsio.__env;

			var originalSyntax = bind(env, env.checkSyntax);

			env.checkSyntax = function (code, filename) {
				var xhr = new XMLHttpRequest();
				xhr.open('POST', '/api/syntax', false);
				xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
				xhr.onreadystatechange = function () {
					if (xhr.readyState != 4) { return; }

					if (xhr.status == 200 && xhr.responseText) {
						var err;
						try {
							var response = JSON.parse(xhr.responseText);
							err = response[1];
						} catch(e) {
							err = xhr.responseText;
						}

						if (console.group) {
							console.group('%c' + filename + '\n', 'color: #33F; font-weight: bold');
							err.forEach(function (e) {
									if (e.err) {
										console.log('%c' + e.err.replace(/error - parse error.\s+/i, ''), 'color: #F55');
										console.log('%c' + e.line + ':%c' + e.code[0], 'color: #393', 'color: #444');
										console.log(new Array(('' + e.line).length + 2).join(' ') + e.code[1]);
									} else {
										console.log('%c ' + e.code.join('\n'), 'color: #F55');
									}
								});
							console.groupEnd();
						} else {
							console.log(filename);
							err.forEach(function (e) {
									if (e.err) {
										console.log(e.err.replace(/error - parse error.\s+/i, ''));
										console.log(e.line + ':' + e.code[0]);
										console.log(new Array(('' + e.line).length + 2).join(' ') + e.code[1]);
									} else {
										console.log(e.code.join('\n'));
									}
								});
						}

						document.body.innerHTML = '<pre style=\'margin-left: 10px; font: bold 12px Consolas, "Bitstream Vera Sans Mono", Monaco, "Lucida Console", Terminal, monospace; color: #FFF;\'>'
							+ '<span style="color:#AAF">' + filename + '</span>\n\n'
							+ err.map(function (e) {
									if (e.err) {
										return '<span style="color:#F55">' + e.err.replace(/error - parse error.\s+/i, '') + '</span>\n'
											+ ' <span style="color:#5F5">' + e.line + '</span>: '
												+ ' <span style="color:#EEE">' + e.code[0] + '</span>\n'
												+ new Array(('' + e.line).length + 5).join(' ') + e.code[1];
									} else {
										return'<span style="color:#F55">' + e.code.join('\n') + '</span>';
									}
								}).join('\n')
							+ '</pre>';
					} else if (xhr.status > 0) {
						originalSyntax(code, filename);
					}
				}

				xhr.send('javascript=' + encodeURIComponent(code));
			}
		};

		if (device.isMobileBrowser) {
			// conn.initLogProxy();
			// conn.initRemoteEval();
		}

		initDebugging();
	}

	GC.buildApp('launchUI');
}
