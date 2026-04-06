const fs = require('fs');

let scheduleJs = fs.readFileSync('schedule-ui.tmp.js', 'utf8');
let timerJs = fs.readFileSync('timer-ui.js', 'utf8');

// 1. Remove import from schedule
scheduleJs = scheduleJs.replace('import "./timer-ui.js";\n', '');
scheduleJs = scheduleJs.replace('import "./timer-ui.js";\r\n', '');
scheduleJs = scheduleJs.replace('import "./timer-ui.js";', '');

// 2. Remove imports from timer
const timerLines = timerJs.split('\n');
let newTimer = [];
let skipImport = true;
for (let line of timerLines) {
  if (skipImport) {
    if (line.includes('} from "https://cdn.jsdelivr.net/gh/lit')) {
      skipImport = false;
    }
  } else {
    newTimer.push(line);
  }
}
timerJs = newTimer.join('\n');

// 3. Append
fs.writeFileSync('schedule-ui.js', scheduleJs + '\n\n' + timerJs, 'utf8');
console.log("Merged safely");
