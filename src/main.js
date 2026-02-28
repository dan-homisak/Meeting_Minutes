import './style.css';
import { createLiveApp } from './live-v4/createLiveApp.js';

createLiveApp({
  windowObject: window,
  documentObject: document,
  isDevBuild: Boolean(import.meta.env?.DEV)
});
