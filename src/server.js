(
  function () {
    "use strict";
    let express = require('express');
    let app = express();
    const request = require('request');
    const rp = require('request-promise');
    const cheerio = require('cheerio');
    const moment = require('moment');
    const bodyParser = require("body-parser");

    /* 
      (async () => {
        const response = await axios.get(
          "https://www.pathofexile.com/character-window/get-stash-items?accountName=[ACCOUNT]&league=Delirium&tabs=0&tabIndex=0", {
            headers: {
              Cookie: "POESESSID=[ID]"
            }
          }
        );
        console.log(`Items in stash:`, response.data.items);
      })();
     **/
    // 使用 bodyparser.json() 將 HTTP 請求方法 POST、DELETE、PUT 和 PATCH，放在 HTTP 主體 (body) 發送的參數存放在 req.body
    app.use(bodyParser.urlencoded({
      extended: false
    }));
    app.use(bodyParser.json({
      "limit": "102400kb"
    }));

    // API router
    app.get('/', function (req, res) {
      res.send("Hello world! POE Trade is ready!");
    });

    app.post('/tradeTest', function (req, res) {
      console.log(moment().format('HH:mm:ss'), "call tradeTest(post) API")
      console.log(req.body)
      res.send("Congratulations! Trade tool is ready!");
    });


    app.post('/ignorePUT', function (req, res) {
      console.log(moment().format('HH:mm:ss'), "call ignore(PUT) API")
      console.log(req.body)
      let accountName = encodeURI(req.body.accountName)
      let options = {
        url: `https://web.poe.garena.tw/api/trade/ignore/${accountName}`,
        method: 'PUT',
        headers: {
          'Cookie': req.body.cookie,
          'Host': 'web.poe.garena.tw',
          'Connection': 'keep-alive',
          'Content-Length': 0,
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Accept': '*/*',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://web.poe.garena.tw',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
          'User-Agent': 'rChinPoeTrade/v1.312.4',
        },
        rejectUnauthorized: false,
        requestCert: false,
        agent: false,
      }
      request(options, function (error, response, body) {
        // console.log(response.statusCode, body)
        res.send(body);
      });
    });
    app.post('/ignoreDELETE', function (req, res) {
      console.log(moment().format('HH:mm:ss'), "call ignore(DELETE) API")
      console.log(req.body)
      let accountName = encodeURI(req.body.accountName)
      let options = {
        url: `https://web.poe.garena.tw/api/trade/ignore/${accountName}`,
        method: 'DELETE',
        headers: {
          'Cookie': req.body.cookie,
          'Host': 'web.poe.garena.tw',
          'Connection': 'keep-alive',
          'Content-Length': 0,
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Accept': '*/*',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://web.poe.garena.tw',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
          'User-Agent': 'rChinPoeTrade/v1.312.4',
        },
        rejectUnauthorized: false,
        requestCert: false,
        agent: false,
      }
      request(options, function (error, response, body) {
        // console.log(response.statusCode, body)
        res.send(body);
      });
    });

    app.post('/get_stash', function (req, res) {
      console.log(moment().format('HH:mm:ss'), "call get_stash API")
      console.log(req.body)
      // let url = encodeURI(req.body.url)
      let options = {
        url: req.body.url,
        method: 'get',
        headers: {
          'accept': '*/*',
          'Cookie': req.body.cookie,
        },
        rejectUnauthorized: false,
        requestCert: false,
        agent: false,
      }
      request(options, function (error, response, body) {
        // console.log(response.statusCode, body)
        res.send(body);
      });
    });

    // post searchJson to garena POE trade API
    app.post('/trade', function (req, res) {
      console.log(moment().format('HH:mm:ss'), "Call trade(post) API", req.body.league)
      console.log(req.body.searchJson.query)
      let league = encodeURI(req.body.league)
      let baseUrl = req.body.baseUrl
      let fetchID = [] // 儲存得到的 result ID, 10 個 ID 為一組陣列
      let options = {
        url: `${baseUrl}/api/trade/search/${league}`,
        // could replace searchJson by `${league}?q={"query": ... }`
        method: 'post',
        headers: {
          'accept': '*/*',
          'Content-Type': 'application/json',
          'User-Agent': 'rChinPoeTrade/v1.312.4',
        },
        rejectUnauthorized: false,
        requestCert: false,
        agent: false,
        json: req.body.searchJson
      }
      if (req.body.cookie) {
        options.headers.Cookie = `POESESSID=${req.body.cookie};`
      }
      // console.log(req.body.cookie)
      request(options, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          console.log(`searchID: ${body.id}, searchTotal: ${body.total}`)
          body.result.forEach((element, index) => {
            let idx = index <= 9 ? 0 : parseInt((index % 100) / 10)
            if (!Array.isArray(fetchID[idx])) {
              fetchID[idx] = []
            }
            fetchID[idx].push(element)
          });
          res.send({
            id: body.id,
            total: body.total,
            fetchID: fetchID
          });
        } else {
          res.status(response.statusCode).send(body);
          console.log(response.statusCode, body)
        }
      });
    });

    let server = app.listen(3031, function () {
      console.log(moment().format('HH:mm:ss'), 'Express server listening on port ' + server.address().port);
    });
    module.exports = app;
  }()
);
