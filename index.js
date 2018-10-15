
/*
JS implementation of the Turing Tumble by Lode Vandevenne, 20170605

Internally works with ASCII art. Symbol meanings:

space: empty spot
\: ramp going right
/: ramp going left
(: bit pointing left
): bit pointing right
x: crossover
_: interceptor
{: gear bit pointing left
}: gear bit pinting right
*: gear
o: blue marble
O: red marble

Also alternative symbols:
.: same as space (but text editor does not remove it at end of lines if "remove spaces at end of lines" is enabled)
v: same as space, in the "template" this one is used to represent the main pins, as opposed to the pins that can only contain a gear and that are denoted with . there
%: same as backslash (\), to use in the javascript literal strings because \ has already other meaning there
+: same as gear, alternative symbol to make it look like it's rotating

For URL code, we use different more URL-compatible ASCII characters:
first character is b for 'board'. Then:
l: ramp left
r: ramp right
x: crossover
i: interceptor
0: bit left
1: bit right
a: gear bit left
b: gear bit right
c: gear on regular spot
g: gear on gear-only spot
e: empty space
f: 3 empty spaces
z: 9 empty spaces

The board has 11x11 pins.
Some pins at the top left and right corner, and all but the center of the bottom row, are unused
Half the pins are full and support all components, the other half support only gear, these form two diamond shaped grids on one 11x11 grid, if you know what I mean...

Blue balls start at x=2,y=-1 with velx=1
Red balls start at x=8,y=-1 with velx=-1
Any ball ending up in bottom left half spawns blue ball, any in bottom right half spawns red ball
Multiple balls at same time are not supported.

Ball physics for long falls and parabolic paths are not emulated. Only going from component to component works correctly. On empty places, the ball will fall straight down.

Gear updates are computed with floodfill algorithm.
*/

// This variable will be true only if the user is doing any active editing. Only
// then will a circuit be saved to local storage.
var did_any_editing = false;

function makeElement(tag, opt_parent) {
  var parent = opt_parent || document.body;
  var el =  document.createElement(tag);
  parent.appendChild(el);
  return el;
}

function makeSizedElement(tag, x, y, w, h, opt_parent) {
  var el =  makeElement(tag, opt_parent);
  el.style.position = 'absolute';
  el.style.left = '' + Math.floor(x) + 'px';
  el.style.top = '' + Math.floor(y) + 'px';
  el.style.width = '' + Math.floor(w) + 'px';
  el.style.height = '' + Math.floor(h) + 'px';
  return el;
}

function makeDiv(x, y, w, h, opt_parent) {
  return makeSizedElement('div', x, y, w, h, opt_parent);
}

var worldDiv = makeDiv(10, 40, 0, 0);

//bind a single argument to a function
function bind(f, arg) {
  var args = Array.prototype.slice.call(arguments, 1);
  var result = function() {
    return f.apply(this, args.concat(Array.prototype.slice.call(arguments)));
  };
  result.bound_f = f; // to be able to "extract" the original function out of it for debugging and by code
  result.bound_arg = arg; // to be able to "extract" the original function out of it for debugging and by code
  return result;
}



function clone(obj) {
  // Handle the 3 simple types, and null or undefined
  if(null == obj || "object" != typeof obj) return obj;

  // Handle Array
  if(obj instanceof Array) {
    var copy = [];
    for (var i = 0, len = obj.length; i < len; i++) {
        copy[i] = clone(obj[i]);
    }
    return copy;
  }

  // Handle Object
  if (obj instanceof Object) {
    var copy = new obj.constructor(); //This makes it also have the correct prototype
    for(var attr in obj) {
      if(obj.hasOwnProperty(attr)) copy[attr] = clone(obj[attr]);
    }
    return copy;
  }

  throw new Error("Cloning this object not supported.");
}

// gets CGI parameter from URL
function getParameterByName(name, opt_url) {
  var url = opt_url || window.location.href;
  name = name.replace(/[\[\]]/g, "\\$&");
  var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)");
  var results = regex.exec(url);
  if (!results) return null;
  if (!results[2]) return '';
  return decodeURIComponent(results[2].replace(/\+/g, " "));
}



function localStorageSupported() {
  try {
    return 'localStorage' in window && window['localStorage'] !== null;
  } catch(e) {
    return false;
  }
}

//remember user settings locally (note that this is all fully local, nothing gets sent to any server)
function setLocalStorage(data, name) {
  if(!localStorageSupported()) return;
  localStorage[name] = data;
}

function getLocalStorage(name) {
  if(!localStorageSupported()) return undefined;
  return localStorage[name];
}

function clearLocalStorage(name) {
  if(!localStorageSupported()) return;
  localStorage.removeItem(name);
}

////////////////////////////////////////////////////////////////////////////////

var W = 11; // board width
var H = 11; // board height
var S = 32; // div render size in pixels (of one tile)
var MARBLEDEFAULT = 20; // standard amount of blue and red marbles

// different sizes: only supports W of form 11+4*N for some integer N, and odd H
var url_w = getParameterByName('w');
if(url_w) {
  W = parseInt(url_w, 10);
  if((W & 3) != 3) W |= 3;
  if(W < 0) W = 3;
  if(W > 27) W = 27;
}
var url_h = getParameterByName('h');
if(url_h) {
  H = parseInt(url_h, 10);
  if((H & 1) != 1) H |= 1;
  if(H < 0) H = 11;
  if(H > 27) H = 27;
}

var D = Math.floor(W / 4);


var url_marbledefault = getParameterByName('m');
if(url_marbledefault) {
  MARBLEDEFAULT = parseInt(url_marbledefault, 10);
}

// template
/*var startboard = `
...v...v...
..v.v.v.v..
.v.v.v.v.v.
v.v.v.v.v.v
.v.v.v.v.v.
v.v.v.v.v.v
.v.v.v.v.v.
v.v.v.v.v.v
.v.v.v.v.v.
v.v.v.v.v.v
.....v.....
`;*/

var startboard = `
...)...%...
../.{.v.(..
.%.{*%.%.).
v.%.).%.%._
.v./.{.%.%.
v.%.{*%.%./
.v.%.).%.x.
v.v./.{.x./
.v.%.{*x./.
v.v.%./.%.v
...../.....
`;

var texturemap = {};
texturemap['\\'] = 0;
texturemap['/'] = 1;
texturemap['('] = 2;
texturemap[')'] = 3;
texturemap['{'] = 4;
texturemap['}'] = 5;
texturemap['*'] = 6;
texturemap['+'] = 7;
texturemap['_'] = 11;
texturemap['x'] = 8;
texturemap['.'] = 9;
texturemap['v'] = 10;
texturemap['V'] = 18;
texturemap['o'] = 12;
texturemap['O'] = 13;
texturemap['h'] = 14;
texturemap[' '] = 15;


var board = [];
// num on top
var numblue = MARBLEDEFAULT;
var numred = MARBLEDEFAULT;
// num on entire board (virtually, as some may have disappeared)
var totalblue = MARBLEDEFAULT;
var totalred = MARBLEDEFAULT;

function loadFromText(s) {
  if(!s) return null;
  var board = [];
  var spos = 0;
  for(var y = 0; y < H; y++) {
    while(s.charCodeAt(spos) < 32) spos++;
    board[y] = [];
    for(var x = 0; x < W; x++) {
      var c = s[spos];
      if(c == ' ' || c == '.' || c == 'v' || c == 'V') c = getEmpty(x, y);
      if(c == '%') c = '\\';
      board[y][x] = c;
      spos++;
    }
  }
  return board;
}

function saveToText(board) {
  var s = '';
  for(var y = 0; y < H; y++) {
    for(var x = 0; x < W; x++) {
      s += board[y][x];
    }
    s += '\n';
  }
  return s;
}

// stringifies a good starting state, NOT the currently ball-rolling state but what you would get after pressing 'restart'
function stringifyState() {
  var saveboard = undefined;
  if(status == STATUS_CRANK) {
    saveboard = board;
  } else if(undoboard2 && undoboard2.length == H) {
    saveboard = undoboard2;
  } else {
    saveboard = board;
  }
  var text = '';
  text += W + ',';
  text += H + ',';
  text += MARBLEDEFAULT + ',';
  text += saveToText(saveboard);
  return text;
}

// returns false if W, H or MARBLEDEFAULT do not match, as that means the URL parameters changed and loading this state is not desired
function parseState(text) {
  var s = text.split(',');
  if(s.length != 4) return false;
  var w = parseInt(s[0], 10);
  var h = parseInt(s[1], 10);
  if(w != W || h != H) return false;
  board = loadFromText(s[3]);
  if(!board) return false;
  setMarblesDefault(parseInt(s[2], 10));

  return true;
}

function loadFromUrl(url) {
  var parts = url.split('_');
  var s = parts[0];
  numblue = parts.length > 1 ? parseInt(parts[1], 10) : 20;
  numred = parts.length > 2 ? parseInt(parts[2], 10) : 20;
  totalblue = numblue;
  totalred = numred;

  s = s.replace(/f/g, 'eee');
  s = s.replace(/z/g, 'eeeeeeeee');
  var spos = 0;
  for(var y = 0; y < H; y++) {
    board[y] = [];
    for(var x = 0; x < W; x++) {
      var c = s[spos];
      var e = getEmpty(x, y);

      if(e == ' ') { board[y][x] = e; continue; }
      else if(e == '.' && c == 'g') c = '*';
      else if(e == '.' && c == 'g') c = '*';
      else if(e == '.' && c != 'g') { board[y][x] = e; continue; }
      else if(c == 'r') c = '\\';
      else if(c == 'l') c = '/';
      else if(c == 'i') c = '_';
      else if(c == 'x') c = 'x';
      else if(c == '0') c = '(';
      else if(c == '1') c = ')';
      else if(c == 'a') c = '{';
      else if(c == 'b') c = '}';
      else if(c == 'c') c = '*';
      else c = getEmpty(x, y);
      board[y][x] = c;
      spos++;
    }
  }
}

function toUrl() {
  var result = '';
  for(var y = 0; y < H; y++) {
    for(var x = 0; x < W; x++) {
      var e = getEmpty(x, y);
      var c = board[y][x];

      if(e == ' ') continue;
      else if(e == '.' && c == '*') c = 'g';
      else if(e == '.' && c == '+') c = 'g';
      else if(e == '.' && c != '*' && c != '+') continue;
      else if(c == '\\') c = 'r';
      else if(c == '/') c = 'l';
      else if(c == '_') c = 'i';
      else if(c == 'x') c = 'x';
      else if(c == '(') c = '0';
      else if(c == ')') c = '1';
      else if(c == '{') c = 'a';
      else if(c == '}') c = 'b';
      else if(c == '*') c = 'c';
      else if(c == '+') c = 'c';
      else c = 'e';
      result += c;
    }
  }
  result = result.replace(/eeeeeeeee/g, 'z');
  result = result.replace(/eee/g, 'f');
  if(numblue != 20 || numred != 20) result += '_' + numblue + '_' + numred;
  return result;
}


function resetURL() {
  if(!hasurlcode) return;
  // it is super confusing if the URL code remains there, while due to running the board now the state may change. So change the URL.
  // the URL cannot be simply changed by assigning window.location, or the page would reload. Instead we can use history pushState:
  if (window.history) {
    var mainurl = '' + window.location;
    var q = mainurl.indexOf('?');
    if (q >= 0) mainurl = mainurl.substr(0, q);
    window.history.pushState('loaded_from_url', 'loaded_from_url', mainurl);
    hasurlcode = false;
  }
}

var divs = [];

var mainleft = 150;
var maintop = 120;

function getEmpty(x, y) {
  if(x + y < D) return ' ';
  if((W - 1 - x) + y < D) return ' ';

  if(x - y - D > 2 && (W - x) - D - 1 - y > 2) return ' ';

  //if(x == ((W-1)/2) && y == 0) return ' ';

  if(x != ((W-1)/2) && y >= (H - 1)) return ' ';
  if(W == 11 && H == 11 && (x == 2 || x == 8) && (y == 3 || y == 7)) return 'V';
  return (x  % 2 == y % 2) ? '.' : 'v';
}

var lastRightClickRemovedCell = '';
var lastRightClickX = 0;
var lastRightClickY = 0;

function initBoardDivs() {
  for(var y = 0; y < H; y++) {
    divs[y] = [];
    for(var x = 0; x < W; x++) {
      var div = makeDiv(mainleft + x * S, maintop + y * S, S, S);
      divs[y][x] = div;
      updateCell(x, y);
    }
  }

  for(var y = 0; y < H; y++) {
    for(var x = 0; x < W; x++) {
      divs[y][x].oncontextmenu = function() {
        // prevent the context menu, otherwise right clicking to remove an item also
        // shows the context menu
        return false;
      };
      divs[y][x].onmousedown = bind(function(x, y, event) {
        if(event.buttons == 2) {
          // right click, remove item
          var e = getEmpty(x, y);
          if(board[y][x] == e) {
            // reason for only allowing to put back if x/y match: otherwise you could put non-allowed parts on gear-only spots with this, plus
            // it's also not the goal that you can use the right mouse button to draw parts in other locations, it's just an undo for accidental
            // right-click removal on this spot
            if(lastRightClickRemovedCell && lastRightClickX == x && lastRightClickY == y) board[y][x] = lastRightClickRemovedCell;
          } else {
            lastRightClickRemovedCell = board[y][x];
            lastRightClickX = x;
            lastRightClickY = y;
            board[y][x] = e;
          }
          updateCell(x, y);
          event.preventDefault();
          if (event.stopPropagation) event.stopPropagation();
          event.cancelBubble = true;
          return false;
        }

        if(event.buttons == 1) {
          // main tool update
          activateTool(x, y);
        }
      }, x, y);
      divs[y][x].ondragstart = function(event) {
        event.preventDefault();
        return false;
      };
      divs[y][x].onmouseenter = bind(function(x, y, event) {
        // this is for when you continue dragging after onmousedown already happened
        if(event.buttons != 1) return;
        var v = tool;
        if(tool == 'h' || tool == 'o' || tool == 'O') return;
        var e = getEmpty(x, y);
        if(e == ' ') return;
        if((e == '.' || e == ' ') && v != '*' && v != '+' && v != ' ' && v != '.' && v != 'v') return;
        updateCounterFromTo(board[y][x], v);
        board[y][x] = v == 'v' ? e : v;
        updateCell(x, y);
      }, x, y);
      divs[y][x].onclick = bind(function(x, y, event) {
        // onclick is only for the gear-only spots
        var e = getEmpty(x, y);
        var isgear = (board[y][x] == '*' || board[y][x] == '+');
        if(e == '.' && (tool == '{' || tool == '}')) {
          updateCounter('*', isgear ? -1 : 1);
          if(isgear) board[y][x] = '.';
          else board[y][x] = '*';
          updateCell(x, y);
          did_any_editing = true;
        } else if(e == '.' && (tool == '(' || tool == ')' || tool == '_' || tool == '/' || tool == '\\' || tool == 'x')) {
          if(isgear) {
            board[y][x] = '.';
            updateCounter('*', -1);
            updateCell(x, y);
            did_any_editing = true;
          }
        }
      }, x, y);
    }
  }
}

function updateBoard() {
  for(var y = 0; y < H; y++) {
    for(var x = 0; x < W; x++) {
      updateCell(x, y);
    }
  }
  updateCounters();
}

var ball = undefined;
var ballx = D-1;
var bally = -1-1;
var velx = 1;
var BLUE = 0; // enum constant
var RED = 1; // enum constant
var color = BLUE;

function initBallDiv() {
  ball = makeDiv(0, 0, S, S);

  ball.onclick = function() {
    removeBall();
  };

  updateBallTexture();
  updateBallPos();
}

var removeBall = function() {
  window.clearTimeout(timeoutid);
  timeoutid = undefined;
  ballx = D - 1;
  bally = H + 2;
  velx = 1;
  color = BLUE;
  updateBallTexture();
  updateBallPos();
  updateBallCount();
  velhistory = [];
  updateTimeButtonBorders();
  status = STATUS_CRANK;
  updateStatusBox();
};

var updateBallPos = function() {
  ball.style.top = '' + (maintop + bally * S) + 'px';
  ball.style.left = '' + (mainleft + ballx * S) + 'px';
  if(bally < -1 || bally > H) ball.style.visibility = 'hidden';
  else ball.style.visibility = 'visible';
  updateBallTexture();
};

var updateBallTexture = function() {
  var danger = false;
  if(board[bally] && board[bally][ballx]) {
    var b = board[bally][ballx];
    if(b == '.' || b == 'v' || b == '*' || b == '+') danger = true;
    // in crossing but with unknown direction
    if(b == 'x' && (velhistory.length == 0 || velhistory[velhistory.length - 1] == 0)) danger = true;
  }
  var t = texturemap[color ? 'O' : 'o'];
  if(danger) t += 8;
  var tilex = t % 8;
  var tiley = Math.floor(t / 8);
  var tilesize = 32;
  ball.className = 'tiles';
  ball.style.backgroundPosition = '' + (-tilesize * tilex) + 'px ' + (-tilesize * tiley) + 'px';
};

function addLaunchRamps() {
  var el =  makeDiv(mainleft + D * S, maintop - S, 32, 32);
  el.style.width = '' + tilesize + 'px';
  el.style.height = '' + tilesize + 'px';
  el.className = 'tiles';
  var tilesize = 32;
  el.style.backgroundPosition = '' + (-tilesize * 0) + 'px ' + (-tilesize * 2) + 'px';
  el.onclick = bind(activateTool, D, -1);

  el =  makeDiv(mainleft + (W - D - 1) * S, maintop - S, 32, 32);
  el.style.width = '' + tilesize + 'px';
  el.style.height = '' + tilesize + 'px';
  el.className = 'tiles';
  var tilesize = 32;
  el.style.backgroundPosition = '' + (-tilesize * 1) + 'px ' + (-tilesize * 2) + 'px';
  el.onclick = bind(activateTool, W - D - 1, -1);
}

addLaunchRamps();

function updateCell(x, y) {
  var c = board[y][x];
  if(c == ' ') {
    c = getEmpty(x, y);
  }
  if(!c) c = ' ';

  var tilex = texturemap[c] % 8;
  var tiley = Math.floor(texturemap[c] / 8);
  var tilesize = 32;
  divs[y][x].className = 'tiles';
  divs[y][x].style.backgroundPosition = '' + (-tilesize * tilex) + 'px ' + (-tilesize * tiley) + 'px';
}

// bottom marble result
var bottommarbles = []; // 0 for blue, 1 for red
var bottomdiv = makeDiv(mainleft + (W - 1) * S, maintop + (H + 1) * S, S, S);
bottomdiv.dir = 'rtl';

function updateBottomDiv() {
  bottomdiv.innerHTML = '';
  for (var i = bottommarbles.length - 1; i >= 0; i--) {
    bottomdiv.innerHTML += (bottommarbles[i] ? '<font color="red">r</font>' : '<font color="blue">b</font>');
  }
}



//var urlsharediv = makeDiv(mainleft, maintop + (H + 1) * S + 20, 1200, S);

var numbluediv = makeDiv(mainleft + D * S + 8, maintop - 2 * S, 32, 32);
numbluediv.style.color = 'blue';
numbluediv.innerHTML = numblue;
var numreddiv = makeDiv(mainleft + (W - D - 1) * S + 16 - 2, maintop - 2 * S, 32, 32);
numreddiv.innerHTML = numred;
numreddiv.style.color = 'red';

function updateBallCount() {
  numbluediv.innerHTML = numblue;
  numreddiv.innerHTML = numred;
}

var blueplus = makeDiv(mainleft + D * S + 24 + 8, maintop - 2 * S, 32, 32);
blueplus.innerHTML = '<b>+</b>';
blueplus.onclick = function() {
  numblue++;
  totalblue++;
  updateBallCount();
}
blueplus.title = 'add extra blue marbles';

var blueminus = makeDiv(mainleft + D * S - 20 + 8, maintop - 2 * S, 32, 32);
blueminus.innerHTML = '<b>-</b>';
blueminus.onclick = function() {
  if(numblue <= 0) return;
  numblue--;
  totalblue--;
  updateBallCount();
}
blueminus.title = 'remove blue marbles';

var redplus = makeDiv(mainleft + (W - D - 1) * S + 40 - 2, maintop - 2 * S, 32, 32);
redplus.innerHTML = '<b>+</b>';
redplus.onclick = function() {
  numred++;
  totalred++;
  updateBallCount();
}
redplus.title = 'add extra red marbles';

var redminus = makeDiv(mainleft + (W - D - 1) * S - 4 - 2, maintop - 2 * S, 32, 32);
redminus.innerHTML = '<b>-</b>';
redminus.onclick = function() {
  if(numred <= 0) return;
  numred--;
  totalred--;
  updateBallCount();
}
redminus.title = 'remove red marbles';

function setMarblesDefault(num) {
  MARBLEDEFAULT = num;
  numblue = MARBLEDEFAULT;
  numred = MARBLEDEFAULT;
  totalblue = MARBLEDEFAULT;
  totalred = MARBLEDEFAULT;
  updateBallCount();
}

var marbles0 = makeSizedElement('button', mainleft + ((W >> 1)) * S - 16, maintop - 2 * S, 20, 20);
marbles0.innerHTML = '0';
marbles0.style.textAlign = 'center';
marbles0.style.padding = '0';
marbles0.onclick = function() { did_any_editing = true; setMarblesDefault(0); }
marbles0.title = 'set default marbles to 0';

var marbles8 = makeSizedElement('button', mainleft + ((W >> 1)) * S + 6, maintop - 2 * S, 20, 20);
marbles8.innerHTML = '8';
marbles8.style.textAlign = 'center';
marbles8.style.padding = '0';
marbles8.onclick = function() { did_any_editing = true; setMarblesDefault(8); }
marbles8.title = 'set default marbles to 8';

var marbles20 = makeSizedElement('button', mainleft + ((W >> 1)) * S + 28, maintop - 2 * S, 20, 20);
marbles20.innerHTML = '20';
marbles20.style.textAlign = 'center';
marbles20.style.padding = '0';
marbles20.onclick = function() { if(MARBLEDEFAULT != 20) did_any_editing = true; setMarblesDefault(20); }
marbles20.title = 'set default marbles to 20';

var marbles99 = makeSizedElement('button', mainleft + ((W >> 1)) * S + 50, maintop - 2 * S, 20, 20);
marbles99.innerHTML = '99';
marbles99.style.textAlign = 'center';
marbles99.style.padding = '0';
marbles99.onclick = function() { did_any_editing = true; setMarblesDefault(99); }
marbles99.title = 'set default marbles to 99';

// If the initial marble default is not 20 (this can only be caused by CGI parameter), add an extra button with that amount
if(MARBLEDEFAULT != 0 && MARBLEDEFAULT != 8 && MARBLEDEFAULT != 20 && MARBLEDEFAULT != 99) {
  var marblesx = makeSizedElement('button', mainleft + ((W >> 1)) * S + 72, maintop - 2 * S, 20, 20);
  marblesx.innerHTML = MARBLEDEFAULT;
  marblesx.style.textAlign = 'center';
  marblesx.style.padding = '0';
  marblesx.onclick = function() { did_any_editing = true; setMarblesDefault(MARBLEDEFAULT); }
  marblesx.title = 'set default marbles to ' +  MARBLEDEFAULT;
}

function updateAll() {
  updateBoard();
  updateBallTexture();
  updateBallPos();
  updateBallCount();
}

function toggleGear(x0, y0) {
  var stack = [[x0, y0]];
  var seen = {};
  var all = [];
  while(stack.length > 0) {
    var x = stack[stack.length - 1][0];
    var y = stack[stack.length - 1][1];
    stack.pop();
    seen['' + x + ',' + y] = true;
    all.push([x, y]);
    for(var i = 0; i < 4; i++) {
      var x2 = (i == 0 ? (x + 1) : (i == 2 ? (x - 1) : x));
      var y2 = (i == 1 ? (y + 1) : (i == 3 ? (y - 1) : y));
      if(x2 < 0 || x2 >= W || y2 < 0 || y2 >= H) continue;
      var c = board[y2][x2];
      if(!(c == '}' || c == '{' || c == '*' || c == '+')) continue;
      if(seen['' + x2 + ',' + y2]) continue;
      seen['' + x2 + ',' + y2] = true;
      stack.push([x2, y2]);
    }
  }
  for(var i = 0; i < all.length; i++) {
    var x = all[i][0];
    var y = all[i][1];
    if(board[y][x] == '{') board[y][x] = '}';
    else if(board[y][x] == '}') board[y][x] = '{';
    else if(board[y][x] == '*') board[y][x] = '+';
    else if(board[y][x] == '+') board[y][x] = '*';
    updateCell(x, y);
  }
}

// make all gears in this group point to the same side, because a group doesn't work
// if two gears point in a different direction, they get stuck.
function fixGearGroup(x0, y0) {
  var stack = [[x0, y0]];
  var seen = {};
  var all = [];
  while(stack.length > 0) {
    var x = stack[stack.length - 1][0];
    var y = stack[stack.length - 1][1];
    stack.pop();
    seen['' + x + ',' + y] = true;
    all.push([x, y]);
    for(var i = 0; i < 4; i++) {
      var x2 = (i == 0 ? (x + 1) : (i == 2 ? (x - 1) : x));
      var y2 = (i == 1 ? (y + 1) : (i == 3 ? (y - 1) : y));
      if(x2 < 0 || x2 >= W || y2 < 0 || y2 >= H) continue;
      var c = board[y2][x2];
      if(!(c == '}' || c == '{' || c == '*' || c == '+')) continue;
      if(seen['' + x2 + ',' + y2]) continue;
      seen['' + x2 + ',' + y2] = true;
      stack.push([x2, y2]);
    }
  }
  var symbol = 'x';
  if(board[y0][x0] == '}') symbol = '}';
  if(board[y0][x0] == '{') symbol = '{';
  for(var i = 0; i < all.length; i++) {
    var x = all[i][0];
    var y = all[i][1];
    if(board[y][x] == '{' || board[y][x] == '}') {
      if(symbol == 'x') symbol = board[y][x];
      if(board[y][x] != symbol) {
        board[y][x] = symbol;
        updateCell(x, y);
      }
    }
  }
}

var STATUS_CRANK = 0; // the initial state: balls not started yet, must crank a lever to begin
var STATUS_ROLLING = 1; // actively rolling
var STATUS_INTERCEPTED = 2; // ball is in interceptor so stopped
var STATUS_NOBLUE = 3; // ran out of blue balls so stopped
var STATUS_NORED = 4; // ran out of red balls so stopped
var status = STATUS_CRANK;


var velhistory = []; // for stepping backwards in time

var timeoutid = undefined;
var duration = 300; // step duration in milliseconds (inverse of speed)
var paused = false;

function move() {
  timeoutid = undefined;
  var stopped = false;
  if(bally == -2) {
    if(color == BLUE) {
      if(numblue <= 0) {
        stopped = true;
        status = STATUS_NOBLUE;
        updateStatusBox();
      }
      else numblue--;
    } else {
      if(numred <= 0) {
        stopped = true;
        status = STATUS_NORED;
        updateStatusBox();
      }
      else numred--;
    }
    updateBallCount();
  }
  if(velx > 0 && ballx == W - 1) velx = 0;
  if(velx < 0 && ballx == 0) velx = 0;
  velhistory.push(velx);
  ballx += velx;
  bally++;
  if(bally == H + 1) {
    velhistory[velhistory.length - 1] = -ballx + velx; // put velocity in it as if we go to x position 0 at end of board
    bottommarbles.push(color);
    updateBottomDiv();
    var newcolor;
    if(ballx < W / 2) {
      newcolor = BLUE;
    } else {
      newcolor = RED;
    }
    var outofmarbles = false;
    if(newcolor == BLUE) {
      if(numblue <= 0) {
        outofmarbles = true;
        status = STATUS_NOBLUE;
        updateStatusBox();
      }
    } else {
      if(numred <= 0) {
        outofmarbles = true;
        status = STATUS_NORED;
        updateStatusBox();
      }
    }
    if(!outofmarbles) {
      if(ballx < W / 2) {
        ballx = D-1;
        bally = -1-1;
        velx = 1;
      } else {
        ballx = W-D-1+1;
        bally = -1-1;
        velx = -1;
      }
      color = newcolor;
    }
    updateBallTexture();
  } else if(bally > H + 1) {
    stopped = true;
  } else if(ballx >= W) {
    console.log('error! going out of board shoult not happen here');
    ballx = W - 1;
    velx = 0;
  } else if(ballx < 0) {
    console.log('error! going out of board shoult not happen here');
    ballx = 0;
    velx = 0;
  } else if(ballx >= 0 && ballx < W && bally >= 0 && bally < H) {
    if(board[bally][ballx] == '_') {
      stopped = true;
      status = STATUS_INTERCEPTED;
      updateStatusBox();
    } else if(board[bally][ballx] == '\\') {
      velx = 1;
    } else if(board[bally][ballx] == '/') {
      velx = -1;
    } else if(board[bally][ballx] == '(') {
      board[bally][ballx] = ')';
      velx = 1;
      updateCell(ballx, bally);
    } else if(board[bally][ballx] == ')') {
      board[bally][ballx] = '(';
      velx = -1;
      updateCell(ballx, bally);
    } else if(board[bally][ballx] == '{' || board[bally][ballx] == '}') {
      if(board[bally][ballx] == '{') velx = 1;
      else velx = -1;
      toggleGear(ballx, bally);
    } else if(board[bally][ballx] == 'x') {
      if(velx == 0) velx = (color == BLUE ? 1 : -1);
    } else {
      velx = 0;
    }
  }

  if(bally < H + 1 && bally > -2 && !stopped && status != STATUS_ROLLING) {
    status = STATUS_ROLLING;
    updateStatusBox();
  }

  updateBallPos();
  if(!paused) {
    if(!stopped) timeoutid = window.setTimeout(move, duration);
    else updateTimeButtonBorders();
  }
}

// move in inverse time direction
function backwards() {
  if(velhistory.length == 0) return;
  if(status != STATUS_ROLLING) {
    status = STATUS_ROLLING;
    updateStatusBox();
  }
  if(bally == -2) {
    if(bottommarbles.length == 0) return;
    bally = H + 1;
    ballx = 0; // we store velocity history of the new marble situation as if from x=0
    color = bottommarbles.pop();
    updateBottomDiv();
    updateBallTexture();
  } else if(bally > H + 1) {
    if(bottommarbles.length == 0) return;
    ballx = 0;
    color = bottommarbles.pop();
    updateBottomDiv();
    updateBallTexture();
  } else if(ballx >= 0 && ballx < W && bally >= 0 && bally < H) {
    if(board[bally][ballx] == '(') {
      board[bally][ballx] = ')';
    } else if(board[bally][ballx] == ')') {
      board[bally][ballx] = '(';
    } else if(board[bally][ballx] == '{' || board[bally][ballx] == '}') {
      toggleGear(ballx, bally);
    }
    updateCell(ballx, bally);
  }
  velx = velhistory.pop();
  ballx -= velx;
  bally--;
  if(bally == -2) {
    if(color) numred++; else numblue++;
    updateBallCount();
  }
  updateBallPos();
  updateTimeButtonBorders();
}

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

function makeButton(x, y, v, fun, opt_graphical, opt_parent) {
  var el;
  if(opt_graphical) {
    var c = v;
    el = makeSizedElement('button', x, y, 32, 32, opt_parent);
    var tilex = texturemap[c] % 8;
    var tiley = Math.floor(texturemap[c] / 8);
    var tilesize = 32;
    el.className = 'tiles';
    el.style.backgroundPosition = '' + (-tilesize * tilex - 2) + 'px ' + (-tilesize * tiley - 2) + 'px';
    el.style.border = v == 'h' ? '2px solid red' : '2px solid #888';
  } else if(typeof(v) === 'string') {
    el = makeSizedElement('button', x, y, 80, 24, opt_parent);
    el.innerHTML = v;
    el.style.textAlign = 'center';
    //el.style.border = DEFAULTBUTTONBORDER;
  }

  el.onclick = function(e) {
    if(helpdiv) {
      document.body.removeChild(helpdiv);
      helpdiv = null;
    }
    fun();
    e.stopPropagation(); // stop propagation, otherwise window.onclick gets activated and would immediately close help dialog opened by a help button
    return false;
  };

  return el;
}

var buttony = maintop - 2 * S;
var rbuttony = maintop - 2 * S;

function placeButton(v, fun, opt_smallright, opt_right, opt_parent) {
  if(opt_smallright) {
    if(opt_right) rbuttony -= 37; else buttony -= 37;
  }
  var x = opt_smallright ? 42 : 5;
  if(opt_right) x += mainleft + S * (W + 2);
  var result = makeButton(x, opt_right ? rbuttony : buttony, v, fun, v.length == 1, opt_parent);
  var h = (v.length == 1 ? 37 : 28);
  if(opt_right) rbuttony += h; else buttony += h;
  return result;
}

function placeButtonSpacer(opt_right) {
  if(opt_right) rbuttony += 12; else buttony += 12;
}

var helpdiv = null;

function makeHelp(text, w, h) {
  if (helpdiv) document.body.removeChild(helpdiv);
  helpdiv = makeDiv(100, maintop + S * H + 55, w, h);
  helpdiv.style.backgroundColor = 'white';
  helpdiv.style.border = '1px solid black';
  helpdiv.style.padding = '30px';
  helpdiv.innerHTML = text;
  var close = makeDiv(w + 40, -10, 20, 20, helpdiv);
  close.innerHTML = '<span style="font-size: 32px">x</span>';
  close.onclick = function() {
    document.body.removeChild(helpdiv);
    helpdiv = null;
  };
  window.onclick = function() {
    if(helpdiv) document.body.removeChild(helpdiv);
    helpdiv = null;
  };
  helpdiv.onclick = function(e) {
    e.stopPropagation();
  };
  helpdiv.style.boxShadow = '3px 3px 3px #bbb';
}

var undoboard = clone(board);
var undoboard2 = clone(board);

placeButton('help', function() {
  makeHelp('Turing Tumble is a mechanical computer game created by Paul Boswell. This site is a JavaScript emulator of the game by Lode Vandevenne, originally released on 2017-06-05. <br><br>' +
      ' It emulates all parts, except parabolic marble physics (it will show a warning sign on the marble if it is in free fall instead, as in real life it may bounce randomly). <br><br>' +
      ' If no marbles are running, use the buttons indicated "blue lever" or "red lever" below the board to release a marble of this color. <br><br>' +
      ' Numbers at the top show amount of blue and red marbles remaining, while at the bottom it will show marbles in the order they arrived from right to left as colored r and b. <br><br>' +
      ' To make your own board, use the erase button to clear the board, then draw tiles on the board by selecting one of the draw buttons then clicking or dragging on one or more valid board tiles to place the currently selected part on. Choose the "hand" tool after drawing to be able to toggle bits, ramps and gears between left and right state with the mouse. Use reset to initialize the marbles, then blue or red lever to send one on its way. See tooltips of each button for more information. <br><br>' +
      ' To control time (speed or pause) or do step by step debugging, use the buttons on the right. The pause and speed buttons indicate with a red border if time is paused or which speed is selected. The status indicator below the right buttons shows if the marble is rolling or stopped for some reason (such as being in an interceptor, or cranking a lever required).<br><br>' +
      ' Most buttons also have tooltips explaining everything in more detail.<br><br>' +
      ' Note that this application is ran locally in your browser only, nothing is sent to or stored in any server or the cloud. <br><br>' +
      ' For more information and the official game rules, see <a target="_blank" href="https://www.kickstarter.com/projects/871405126/turing-tumble-gaming-on-a-mechanical-computer/description">Turing Tumble\'s Kickstarter Page</a>. The demo1, demo2 and addition demos also come from the material on this page.',
      550, 800)
}).title = 'display help';


var urlclearid = 0;
placeButton('url', function() {
  var url = '' + window.location;
  var q = url.indexOf('?');
  if (q >= 0) url = url.substr(0, q);
  url += '?board=' + toUrl();
  if(W != 11) url += '&w=' + W;
  if(H != 11) url += '&h=' + H;
  makeHelp('<a href="' + url + '">Share URL</a>: ' + url + '<br>', 1000, 16);
}).title = 'Share your board: shows a link with a code in the URL that you can share with others.';

placeButtonSpacer();

placeButton('stop', function() {
  removeBall();
}).title = 'Removes the currently rolling marble from the board  (to your own pocket, not to the bottom or top of the board).';

function reset() {
  numblue = totalblue;
  numred = totalred;
  removeBall();
  bottommarbles = [];
  updateBottomDiv();
}

placeButton('reset', function() {
  reset();
}).title = 'Resets the marbles (but not the bits on the board): puts all 20 of each marble back to the top of the board.';

placeButton('restart', function() {
  reset();
  undo2();
}).title = 'Does undo and reset, which means if you pulled a lever and several marbles rolled down, this will put all marbles back and in addition put the bits back to the state when you last pulled a lever while no marbles were at the bottom. Uses its own independent undo state different from the undo button.';


var timebuttons = [];

function cannotContinue() {
  return (color == RED && numred == 0 && bally < -1) || (color == BLUE && numblue == 0 && bally < -1) || (board[bally] && board[bally][ballx] == '_');
}

function continueFromPause(opt_withinitialtimeout) {
  paused = false;
  if(!cannotContinue()) {
    if (opt_withinitialtimeout) {
      if (timeoutid != undefined) window.clearTimeout(timeoutid);
      timeoutid = window.setTimeout(move, duration);
    } else {
      move();
    }
  }
  updateTimeButtonBorders();
}

timebuttons[0] = placeButton('pause', function() {
  if(!paused) {
    paused = true
    window.clearTimeout(timeoutid);
    timeoutid = undefined;
    updateTimeButtonBorders();
  } else {
    paused = false;
    move();
    updateTimeButtonBorders();
  }
}, false, true);
timebuttons[0].title = 'pause rolling the marble. press again to continue.';


placeButtonSpacer();

function setTimeSpeed(dur) {
  //if(status == STATUS_CRANK) crankLever(BLUE); // convenience feature: if you choose the speed while it's waiting for cranking lever, crank it
  duration = dur;
  if (timeoutid != undefined) window.clearTimeout(timeoutid);
  continueFromPause();
}

timebuttons[1] = placeButton('slow', function() {
  setTimeSpeed(1000);
}, false, true);
timebuttons[1].title = 'set speed to 1 second per step';

timebuttons[2] = placeButton('medium', function() {
  setTimeSpeed(300);
}, false, true);
timebuttons[2].title = 'set speed to 300 milliseconds per step';

timebuttons[3] = placeButton('fast', function() {
  setTimeSpeed(100);
}, false, true);
timebuttons[3].title = 'set speed to 100 milliseconds per step';

timebuttons[4] = placeButton('fastest', function() {
  setTimeSpeed(5);
}, false, true);
timebuttons[4].title = 'set speed to the fastest per frame possible';

function updateTimeButtonBorders() {
  var j = 0;
  if(paused) j = 0;
  else if(duration == 1000) j = 1;
  else if(duration == 300) j = 2;
  else if(duration == 100) j = 3;
  else if(duration == 5) j = 4;
  else j = -1;
  for (var i = 0; i < 5; i++) timebuttons[i].style.border = (i == j) ? '2px solid red' : '';
}

placeButtonSpacer(true);

placeButton('backstep', function() {
  paused = true;
  updateTimeButtonBorders();
  window.clearTimeout(timeoutid);
  backwards();
  window.clearTimeout(timeoutid);
  timeoutid = undefined;
}, false, true).title = 'step backwards in time. Opposite direction of the step button. Only goes as far back in time as it can remember, which is usually since last time you cranked a lever.';

placeButton('step', function() {
  if(cannotContinue()) return;
  paused = true;
  updateTimeButtonBorders();
  window.clearTimeout(timeoutid);
  move();
  window.clearTimeout(timeoutid);
  timeoutid = undefined;
}, false, true).title = 'work with single steps instead of timer. Will pause time and this button moves time forward instead. If nothing happens, maybe you need to crank a lever to release a ball.';

var statusbox = makeDiv(5 + mainleft + S * (W + 2), rbuttony + 12, 120, 32);
statusbox.style.border = '1px solid #0d0';
statusbox.style.textAlign = 'center';
statusbox.style.textAlign = 'center';
statusbox.style.lineHeight = '32px';
statusbox.title = 'shows the status of the marble: whether it is rolling, or the reason why it isn\'t if not. Even if time is paused, this shows "rolling" if the physical state is such that the ball would be rolling.';


function updateStatusBox() {
  if(status == STATUS_CRANK) statusbox.innerHTML = 'crank&nbsp;a&nbsp;lever';
  else if(status == STATUS_ROLLING) statusbox.innerHTML = 'tumbling';
  else if(status == STATUS_INTERCEPTED) statusbox.innerHTML = 'intercepted';
  else if(status == STATUS_NOBLUE) statusbox.innerHTML = 'blue&nbsp;empty';
  else if(status == STATUS_NORED) statusbox.innerHTML = 'red&nbsp;empty';
  else statusbox.innerHTML = 'unknown status';
}

updateStatusBox();

function crankLever(leverColor) {
  if(leverColor == BLUE && numblue <= 0) return;
  if(leverColor == RED && numred <= 0) return;
  velhistory = []; // backstepping not supported when we remove ball from board, as it only supports going 1 step up in y direction at the time
  undoboard = clone(board); prevtool_forundo = '?';
  if(numred == totalred && numblue == totalblue) undoboard2 = clone(board);
  window.clearTimeout(timeoutid);
  if(leverColor == BLUE) {
    ballx = D-1;
    velx = 1;
  } else {
    ballx = W-D-1+1;
    velx = -1;
  }
  bally = -1-1;
  color = leverColor;
  updateBallTexture();
  updateBallPos();
  updateBallCount();
  move();
  updateTimeButtonBorders();
}


makeButton(mainleft, maintop + H * S, 'blue&nbsp;lever', function() {
  if(numblue <= 0) {
    makeHelp('Blue marbles empty. Add extras with the "+" at the top or use reset', 400, 32);
    return;
  }
  crankLever(BLUE);
}).title = 'Crank the blue lever, releases a new blue marble at the top (NOTE: multiple marbles at same time not supported so currently active marble will be removed)';

/*var asdf = makeDiv(mainleft, maintop + (H + 1) * S, 80, 20);
asdf.innerHTML = 'highlight';
asdf.style.textAlign = 'center';*/

var counter_ramp_el;
var counter_cross_el;
var counter_intercept_el;
var counter_bit_el;
var counter_gearbit_el;
var counter_gear_el;
var counter_total_el;

function addCounters() {
  var p = 0;
  var div;

  div = makeSizedElement('div', mainleft, maintop + (H + p + 2) * S, 32, 32);
  var tilex = texturemap['/'] % 8;
  var tiley = Math.floor(texturemap['/'] / 8);
  div.className = 'tiles';
  div.style.backgroundPosition = '' + (-32 * tilex - 2) + 'px ' + (-32 * tiley - 2) + 'px';
  div.onclick = function(){selectTool('/');}; // due to easy confusion of these with the buttons, why not just let them act as such
  counter_ramp_el = makeSizedElement('div', mainleft + 32, maintop + (H + p + 2) * S + 6, 80, 32);
  div.title = 'amount of ramps used. Official max amount: 30';
  p++;

  div = makeSizedElement('div', mainleft, maintop + (H + p + 2) * S, 32, 32);
  var tilex = texturemap['x'] % 8;
  var tiley = Math.floor(texturemap['x'] / 8);
  div.className = 'tiles';
  div.style.backgroundPosition = '' + (-32 * tilex - 2) + 'px ' + (-32 * tiley - 2) + 'px';
  div.onclick = function(){selectTool('x');}; // due to easy confusion of these with the buttons, why not just let them act as such
  counter_cross_el = makeSizedElement('div', mainleft + 32, maintop + (H + p + 2) * S + 6, 80, 32);
  div.title = 'amount of crossovers used. Official max amount: 6';
  p++;

  div = makeSizedElement('div', mainleft, maintop + (H + p + 2) * S, 32, 32);
  var tilex = texturemap['_'] % 8;
  var tiley = Math.floor(texturemap['_'] / 8);
  div.className = 'tiles';
  div.style.backgroundPosition = '' + (-32 * tilex - 2) + 'px ' + (-32 * tiley - 2) + 'px';
  div.onclick = function(){selectTool('_');}; // due to easy confusion of these with the buttons, why not just let them act as such
  counter_intercept_el = makeSizedElement('div', mainleft + 32, maintop + (H + p + 2) * S + 6, 80, 32);
  div.title = 'amount of interceptors used. Official max amount: 3';
  p++;

  div = makeSizedElement('div', mainleft, maintop + (H + p + 2) * S, 32, 32);
  var tilex = texturemap['('] % 8;
  var tiley = Math.floor(texturemap['('] / 8);
  div.className = 'tiles';
  div.style.backgroundPosition = '' + (-32 * tilex - 2) + 'px ' + (-32 * tiley - 2) + 'px';
  div.onclick = function(){selectTool('(');}; // due to easy confusion of these with the buttons, why not just let them act as such
  counter_bit_el = makeSizedElement('div', mainleft + 32, maintop + (H + p + 2) * S + 6, 80, 32);
  div.title = 'amount of bits used. Official max amount: 10';
  p++;

  div = makeSizedElement('div', mainleft, maintop + (H + p + 2) * S, 32, 32);
  var tilex = texturemap['{'] % 8;
  var tiley = Math.floor(texturemap['{'] / 8);
  div.className = 'tiles';
  div.style.backgroundPosition = '' + (-32 * tilex - 2) + 'px ' + (-32 * tiley - 2) + 'px';
  div.onclick = function(){selectTool('{');}; // due to easy confusion of these with the buttons, why not just let them act as such
  counter_gearbit_el = makeSizedElement('div', mainleft + 32, maintop + (H + p + 2) * S + 6, 80, 32);
  div.title = 'amount of gearbits used. Official max amount: 8';
  p++;

  div = makeSizedElement('div', mainleft, maintop + (H + p + 2) * S, 32, 32);
  var tilex = texturemap['*'] % 8;
  var tiley = Math.floor(texturemap['*'] / 8);
  div.className = 'tiles';
  div.style.backgroundPosition = '' + (-32 * tilex - 2) + 'px ' + (-32 * tiley - 2) + 'px';
  div.onclick = function(){selectTool('*');}; // due to easy confusion of these with the buttons, why not just let them act as such
  counter_gear_el = makeSizedElement('div', mainleft + 32, maintop + (H + p + 2) * S + 6, 80, 32);
  div.title = 'amount of gears used. Official max amount: 4';
  p++;

  counter_total_el = makeSizedElement('div', mainleft, maintop + (H + p + 2) * S + 6, 80, 32);
  counter_total_el.innerHTML = 'total: /';
  counter_total_el.title = 'Total count of all parts used on the board';
  p++;
}

addCounters();

var num_ramp = 0;
var num_cross = 0;
var num_intercept = 0;
var num_bit = 0;
var num_gearbit = 0;
var num_gear = 0;
var num_total = 0;

function updateCounters() {
  num_ramp = 0;
  num_cross = 0;
  num_intercept = 0;
  num_bit = 0;
  num_gearbit = 0;
  num_gear = 0;
  for(var y = 0; y < H; y++) {
    for(var x = 0; x < W; x++) {
      if(board[y][x] == '/' || board[y][x] == '\\' || board[y][x] == '%') num_ramp++;
      if(board[y][x] == 'x') num_cross++;
      if(board[y][x] == '_') num_intercept++;
      if(board[y][x] == '(' || board[y][x] == ')') num_bit++;
      if(board[y][x] == '{' || board[y][x] == '}') num_gearbit++;
      if(board[y][x] == '*' || board[y][x] == '+') num_gear++;
    }
  }

  num_total = num_ramp + num_cross + num_intercept + num_bit + num_gearbit + num_gear;

  // When changing this code, don't forget to also change the function updateCounter below to match!
  counter_ramp_el.innerHTML = ': ' + num_ramp;
  counter_cross_el.innerHTML = ': ' + num_cross;
  counter_intercept_el.innerHTML = ': ' + num_intercept;
  counter_bit_el.innerHTML = ': ' + num_bit;
  counter_gearbit_el.innerHTML = ': ' + num_gearbit;
  counter_gear_el.innerHTML = ': ' + num_gear;
  counter_total_el.innerHTML = 'total: ' + num_total;
}
function updateCounter(t, num) {
  if(t == '/' || t == '\\' || t == '%') {
    num_ramp += num;
    num_total += num;
    counter_ramp_el.innerHTML = ': ' + num_ramp;
  }
  if(t == 'x') {
    num_cross += num;
    num_total += num;
    counter_cross_el.innerHTML = ': ' + num_cross;
  }
  if(t == '_') {
    num_intercept += num;
    num_total += num;
    counter_intercept_el.innerHTML = ': ' + num_intercept;
  }
  if(t == '(' || t == ')') {
    num_bit += num;
    num_total += num;
    counter_bit_el.innerHTML = ': ' + num_bit;
  }
  if(t == '{' || t == '}') {
    num_gearbit += num;
    num_total += num;
    counter_gearbit_el.innerHTML = ': ' + num_gearbit;
  }
  if(t == '*' || t == '+') {
    num_gear += num;
    num_total += num;
    counter_gear_el.innerHTML = ': ' + num_gear;
  }

  counter_total_el.innerHTML = 'total: ' + num_total;
}

function updateCounterFromTo(from, to) {
  updateCounter(from, -1);
  updateCounter(to, 1);
}

makeButton(mainleft + W * S - 80, maintop + H * S, 'red&nbsp;lever', function() {
  if(numred <= 0) {
    makeHelp('Red marbles empty. Add extras with the "+" at the top or use reset', 400, 32);
    return;
  }
  crankLever(RED);
}).title = 'Crank the red lever, releases a new red marble at the top (NOTE: multiple marbles at same time not supported so currently active marble will be removed)';

var toolbuttondata = [
  'h', 'the hand tool allows to toggle parts between left and right state and activates gears (can also be selected with shortcut key "h").',
  'v', 'draw empty cell',
  'o', 'Manually add or move a blue marble rolling on the board (if there is already a marble on the board, moves it to where you click and changes it to blue. If there was no marble on the board, then this adds a spare marble, not one from the top count). Clicking a rolling marble itself removes it instead (to your own pocket, not to the bottom or top of the board).',
  'O', 'Manually add or move a red marble rolling on the board (if there is already a marble on the board, moves it to where you click and changes it to red. If there was no marble on the board, then this adds a spare marble, not one from the top count). Clicking a rolling marble itself removes it instead (to your own pocket, not to the bottom or top of the board).',
  '/', 'draw left ramp (can mirror this tool with shortcut key "f")',
  '\\', 'draw right ramp (can mirror this tool with shortcut key "f")',
  'x', 'draw crossover',
  '_', 'draw interceptor',
  '(', 'draw bit 0 (can mirror this tool with shortcut key "f")',
  ')', 'draw bit 1 (can mirror this tool with shortcut key "f")',
  '{', 'draw gear bit 0 (can mirror this tool with shortcut key "f")',
  '}', 'draw gear bit 1 (can mirror this tool with shortcut key "f")',
  '*', 'draw gear. Unlike other parts, these can go on any pin of the board. If in group of gears, all gears must point to same side.'
];

var toolbuttons = [];
var toolindexmap = {};

function selectTool(t) {
  var i = toolindexmap[t];
  tool = t;
  for(var j = 0; j < toolbuttons.length; j++) toolbuttons[j].style.border = ((i == j) ? '2px solid red' : '2px solid #888');
}

for(var i = 0; i < toolbuttondata.length; i += 2) {
  var j = i / 2;
  var b = placeButton(toolbuttondata[i], bind(function(t, i) {
    selectTool(t);
  }, toolbuttondata[i], j), (j > 0 && (j & 1)));
  b.title = toolbuttondata[i + 1];
  toolbuttons.push(b);
  toolindexmap[toolbuttondata[i]] = (i >> 1);
}


placeButton('erase', function() {
  did_any_editing = true;
  undoboard = clone(board); prevtool_forundo = '?';
  for(var y = 0; y < H; y++) {
    for(var x = 0; x < W; x++) {
      board[y][x] = getEmpty(x, y);
      updateCell(x, y);
    }
  }
  reset();
  resetURL();
  updateCounters();
}).title = 'erases the entire board';

/*placeButton('fill', function() {
  did_any_editing = true;
  undoboard = clone(board); prevtool_forundo = '?';
  for(var y = 0; y < H; y++) {
    for(var x = 0; x < W; x++) {
      var e = getEmpty(x, y);
      if(e == 'v') board[y][x] = tool.length == 1 ? tool : '(';
      else board[y][x] = e;
      updateCell(x, y);
    }
  }
  reset();
}).title = 'fills the board with the tile you\'re currently painting with';*/

function undo() {
  prevtool_forundo = '?';
  if(!undoboard || undoboard.length != H) return;
  var temp = clone(board);
  board = clone(undoboard);
  undoboard = temp;
  updateBoard();
}

function undo2() {
  if(!undoboard2 || undoboard2.length != H) return;
  var temp = clone(board);
  board = clone(undoboard2);
  undoboard2 = temp;
  updateBoard();
}

placeButton('undo', function() {
  undo();
  resetURL();
}).title = 'undos last board editing operation';

var saveboard;

placeButton('store', function() {
  saveboard = clone(board);
}).title = 'saves the current board to memory, allowing to recall it with the load button. This allows to store temporary work while drawing. It only remembers it in current session, not after browser refresh. You can use the URL button instead and store the URL elsewhere to remember a state more permanently.';

placeButton('recall', function() {
  if(!saveboard) return;
  undoboard = clone(board); prevtool_forundo = '?';
  board = clone(saveboard);
  updateBoard();
  reset();
  resetURL();
}).title = 'loads the board state that was saved with "store"';

placeButtonSpacer();

if(W == 11 && H == 11) {

placeButton('demo1', function() {
  undoboard = clone(board); prevtool_forundo = '?';
  board = loadFromText(`
...)...%...
../.{.v.(..
.%.{*%.%.).
v.%.).%.%._
.v./.{.%.%.
v.%.{*%.%./
.v.%.).%.x.
v.v./.{.x./
.v.%.{*x./.
v.v.%./.%.v
...../.....
`);
  updateBoard();
  reset();
  resetURL();
  if(MARBLEDEFAULT == 20) {
    did_any_editing = false;
    clearLocalStoredBoard(); // this demo is the main startup demo, so clear local storage if this is chosen as that one is already chosen as default without it (with ball autostarting even)
  } else {
    did_any_editing = true;
  }
}).title = 'bbrbbbbrbbbbbbbb example. Crank blue lever to run it';

placeButton('demo2', function() {
  undoboard = clone(board); prevtool_forundo = '?';
  board = loadFromText(`
...)...(...
..%.%././..
.v.%.x./.v.
v.v./.%.v.v
.v.%.v./.v.
v.v./.%.v.v
.v.%.v./.v.
v.v./.%.v.v
.v.%.v./.v.
v.v./.%.v.v
.....v.....
`);
  updateBoard();
  reset();
  resetURL();
  did_any_editing = true;
}).title = 'bbrrbbrrbbrr.... example. Crank blue lever to run it';

var binaryaddinfo = 'This setup performs binary addition of the left 3-bit number to the right 4-bit number, and stores the result in the right number. A bit pointing left means off, right means on. In each number, the topmost bit has value 1, the second value 2, the third value 4 and the fourth value 8. Use the hand tool to set the input, then let it run until it finishes to see the result.<br/><br/>' +
                    'For example, the initial state when loading this demo has value 1 in both numbers, and after running will result in the right number showing binary "2"';


placeButton('addition', function() {
  undoboard = clone(board); prevtool_forundo = '?';
  board = loadFromText(`
...)...)...
.././.%.%..
.%.(.v.(./.
v././.%.%.v
.%.(.v.(./.
v././.%.%.v
.%.%.v.(./.
v.%.%././.v
.v.%._./.v.
v.v.%./.v.v
.....x.....
`);
  updateBoard();
  reset();
  makeHelp(binaryaddinfo, 500, 180);
  resetURL();
  did_any_editing = true;
}).title = 'binary addition example. Crank blue lever to run it';

var niminfo = 'Play single-pile nim against the mechanical computer. Each player may choose 1, 2 or 3 blue marbles on their turn. The player who has 0 blue marbles left at the start of their turn loses, in other words the player who can take the last marble wins! To play: when the group of gears points right, it is your turn. Crank the blue lever one, two or three times and wait for the animation to finish each time. After your turn, switch the gears to the left with the hand tool and crank the blue lever once to let the computer do its turn. It will automatically play one, two or three marbles and then it will automatically set the gears back to point to the right to indicate it is your turn again.<br/><br/>' +
              'Variants: to make it extra hard, set the gears to the left initially to let the computer start. The game starts with 15 blue marbles (and 0 red marbles, the red side ends motion). Other starting amounts are possible, and require different starting settings of the 3 blue bits to let the computer play optimally. Those combinations are left as exercise to the reader :).';


placeButton('nim', function() {
  undoboard = clone(board); prevtool_forundo = '?';
  reset();
  loadFromUrl(`1i10eerrlfrxfelbfrbglfbgrfbgblfxlflrfr_15_0`);
  updateAll();
  makeHelp(niminfo, 500, 400);
  resetURL();
  did_any_editing = true;
}).title = niminfo;
}

var tool = 'h';
var prevtool_forundo = 'h';

function activateTool(x, y) {
  if(tool != 'h' && tool != 'o' && tool != 'O') did_any_editing = true;
  if(tool != prevtool_forundo) undoboard = clone(board);
  prevtool_forundo = tool;
  resetURL();
  if(tool == 'o' || tool == 'O') {
    ballx = x;
    bally = y;
    color = (tool == 'o') ? BLUE : RED;
    var v = (y < 0 ? (x < W / 2 ? '\\' : '/') : board[y][x]);
    if(v == '/' || v == '(' || v == '{') velx = -1;
    else if(v == '\\' || v == ')' || v == '}') velx = 1;
    else if(v == 'x') velx = ((velx == 0) ? 1 : velx);
    else velx = 0;
    velhistory = [];
    status = v == '_' ? STATUS_INTERCEPTED : STATUS_ROLLING;
    updateStatusBox();
    updateBallPos();
    updateBallTexture();
    if(!paused) {
      if (timeoutid != undefined) window.clearTimeout(timeoutid);
      continueFromPause(true);
    }
    return;
  }
  if(x < 0 || x >= W || y < 0 || y >= H) return;
  var b = board[y][x];
  if(b == '+') b = '*'; // graphical-only effect is effectively a regular gear
  if(b == '%') b = '\\'; // in case the backslash-avoiding notation ends up in the actual board
  var v = tool;
  if(tool == 'h') {
    v = b;
    if(b == '/') v = '\\';
    else if(b == '\\') v = '/';
    else if(b == '(') v = ')';
    else if(b == ')') v = '(';
    else if(b == '{' || b == '}' || b == '+' || b == '*') {
      toggleGear(x, y);
      return;
    } else return;
  }
  var e = getEmpty(x, y);
  if(e == ' ') return;
  if((e == '.' || e == ' ') && v != '*' && v != '+' && v != ' ' && v != '.' && v != 'v') return;
  if(b == v) v = e; // if the board already has what you want to place on it, instead toggle it to empty
  updateCounterFromTo(b, v);
  board[y][x] = v == 'v' ? e : v;
  updateCell(x, y);
  if(v == '+' || v == '*' || v == '{' || v == '}') fixGearGroup(x, y);
}



updateTimeButtonBorders();



document.onkeypress = function(e) {
  var k;
  var ctrl;
  if (window.event != null) {
    k = window.event.keyCode;
    ctrl = window.event.ctrlKey;
  } else {
    k = e.charCode;
    if(k == 0) k = e.keyCode;
    ctrl = e.ctrlKey;
  }
  var c = String.fromCharCode(k).toLowerCase();

  var id = null;
  var result = false;
  if(!ctrl) {
    if(c == 'f') {
      if(tool == ')') selectTool('(');
      else if(tool == '(') selectTool(')');
      else if(tool == '/') selectTool('\\');
      else if(tool == '\\') selectTool('/');
      else if(tool == '{') selectTool('}');
      else if(tool == '}') selectTool('{');
    } else if(c == 'h') {
      selectTool('h');
    } else result = true;
  }
  else result = true;

  var button = id ? document.getElementById('button_' + id) : null;
  if(button && button.onclick) {
    button.onclick();
  }
  else if(button && button.parentElement && button.parentElement.onclick) {
    button.parentElement.onclick();
  }

  return result; //this overrides shortcuts in e.g. firefox (e.g. / would do quick find in firefox)
}

function clearLocalStoredBoard() {
  clearLocalStorage('jstumble_board');
  did_any_editing = false;
}

window.onbeforeunload = function() {
  if(!did_any_editing) return;
  var text = stringifyState();
  if(!text) return;
  setLocalStorage(text, 'jstumble_board');
};

var hasurlcode = false;
var urlstring = getParameterByName('board');

var loaded = false;
var autostart = false;

if(!loaded && urlstring) {
  loadFromUrl(urlstring);
  hasurlcode = true;
  bally = H + 2;
  loaded = true;
}

if(!loaded) {
  var text = getLocalStorage('jstumble_board') || '';
  if(text && parseState(text)) {
    loaded = true;
    bally = H + 2;
  }
}

if(!loaded) {
  if(W == 11 && H == 11) {
    board = loadFromText(startboard);
    loaded = true;
    //numblue--;
    bally = -2;
    autostart = true;
  }
}

if(!loaded) {
  for(var y = 0; y < H; y++) {
    board[y] = [];
    for(var x = 0; x < W; x++) {
      board[y][x] = getEmpty(x, y);
    }
  }
  loaded = true;
}

initBoardDivs();
initBallDiv();
updateCounters();
updateBallCount();
updateTimeButtonBorders();
if(autostart) move();
