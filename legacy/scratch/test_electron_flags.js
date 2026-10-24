const { app } = require('electron');
app.commandLine.appendSwitch('in-process-gpu');
app.on('ready', () => {
  console.log('App ready with in-process-gpu');
  app.quit();
});
