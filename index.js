'use strict';
require('dotenv').config('')
const express = require('express')
const mountRoutes = require('./routes')

// Constants
const PORT = 8080;
const HOST = '0.0.0.0';

// App
const app = express();
mountRoutes(app)

app.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);
