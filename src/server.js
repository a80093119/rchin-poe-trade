(
  function () {
    "use strict";
    let express = require('express');
    let app = express();
    // 改用 axios 取代已停止維護的 request/request-promise（相同行為：非 2xx 也照樣回應）
    const axios = require('axios');
    const https = require('https');
    const moment = require('moment');
    const bodyParser = require("body-parser");
    const localErrorMsg = '無法正確獲得官方 API 資源，請稍後再試'
    const UA = 'OAuth rChinPoeTrade/1.327.2 (contact: b10121035@yuntech.edu.tw)'
    // 保留原本 request 的 rejectUnauthorized:false 行為（部分官方/Garena 節點憑證鏈較特殊）
    const httpsAgent = new https.Agent({ rejectUnauthorized: false })
    // validateStatus 一律 true → 不因非 2xx 拋錯，維持原 request(callback) 「有 response 就處理」的語意
    const axiosBase = { httpsAgent, validateStatus: () => true, timeout: 30000 }

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

    app.post('/ignorePUT', async function (req, res) {
      console.log(moment().format('HH:mm:ss'), "call ignore(PUT) API")
      console.log(req.body)
      let baseUrl = req.body.baseUrl
      let accountName = encodeURI(req.body.accountName)
      try {
        const response = await axios.put(`${baseUrl}/api/trade/ignore/${accountName}`, '', {
          ...axiosBase,
          headers: {
            'Cookie': req.body.cookie,
            'Host': baseUrl.replace('https://', ''),
            'Connection': 'keep-alive',
            'Content-Length': 0,
            'Pragma': 'no-cache',
            'Cache-Control': 'no-cache',
            'Accept': '*/*',
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': baseUrl,
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
            'User-Agent': UA,
          }
        })
        res.status(response.status).send(response.data);
      } catch (e) {
        res.status(500).send(localErrorMsg);
      }
    });

    app.post('/get_stash', async function (req, res) {
      console.log(moment().format('HH:mm:ss'), "call get_stash API")
      console.log(req.body)
      try {
        const response = await axios.get(req.body.url, {
          ...axiosBase,
          headers: {
            'accept': '*/*',
            'Cookie': req.body.cookie,
            'User-Agent': UA,
          }
        })
        res.send(response.data);
      } catch (e) {
        res.status(500).send(localErrorMsg);
      }
    });

    app.post('/get_leagues', async function (req, res) {
      console.log(moment().format('HH:mm:ss'), "call get_leagues API")
      console.log(req.body)
      try {
        const response = await axios.get(`${req.body.baseUrl}/api/trade/data/leagues`, {
          ...axiosBase,
          headers: {
            'accept': '*/*',
            'User-Agent': UA,
          }
        })
        res.status(response.status).send(response.data != null ? response.data : localErrorMsg);
      } catch (e) {
        res.status(500).send(localErrorMsg);
      }
    });

    // post searchJson to garena POE trade API
    app.post('/trade', async function (req, res) {
      console.log(moment().format('HH:mm:ss'), "Call trade(post) API", req.body.league)
      console.log(req.body.searchJson.query)
      let league = encodeURI(req.body.league)
      let baseUrl = req.body.baseUrl
      let fetchID = [] // 儲存得到的 result ID, 10 個 ID 為一組陣列
      const headers = {
        'accept': '*/*',
        'Content-Type': 'application/json',
        'User-Agent': UA,
      }
      if (req.body.cookie) {
        headers.Cookie = `POESESSID=${req.body.cookie};`
      }
      try {
        const response = await axios.post(`${baseUrl}/api/trade/search/${league}`, req.body.searchJson, {
          ...axiosBase,
          headers
        })
        const body = response.data
        if (response.status === 200 && body && Array.isArray(body.result)) {
          console.log(`searchID: ${body.id}, searchTotal: ${body.total}`)
          body.result.forEach((element, index) => {
            let idx = index <= 9 ? 0 : parseInt((index % 100) / 10)
            if (!Array.isArray(fetchID[idx])) {
              fetchID[idx] = []
            }
            fetchID[idx].push(element)
          });
          // x-rate-limit-ip-state 缺漏時給預設，避免 split 崩潰
          let rl = response.headers['x-rate-limit-ip-state'] || '0:0:0,0:0:0,0:0:0'
          let limitString = rl.split(",")
          let limitState = {
            "first": parseInt(limitString[0].substring(0, limitString[0].indexOf(':')), 10),
            "second": parseInt(limitString[1].substring(0, limitString[1].indexOf(':')), 10),
            "third": parseInt(limitString[2].substring(0, limitString[2].indexOf(':')), 10),
          }
          res.send({
            id: body.id,
            total: body.total,
            resultLength: body.result.length,
            fetchID: fetchID,
            limitState: limitState
          });
        } else {
          res.status(response.status || 500).send(body != null ? body : localErrorMsg);
        }
      } catch (e) {
        res.status(500).send(localErrorMsg);
      }
    });

    app.post('/trade_fetch', async function (req, res) {
      console.log(moment().format('HH:mm:ss'), "call trade_fetch API")
      console.log(req.body)
      const { baseUrl, element, fetchQueryID } = req.body
      try {
        const response = await axios.get(`${baseUrl}/api/trade/fetch/${element}?query=${fetchQueryID}`, {
          ...axiosBase,
          headers: {
            'accept': '*/*',
            'User-Agent': UA,
          }
        })
        const rl = response.headers['x-rate-limit-ip-state']
        if (rl != null) res.set('x-rate-limit-ip-state', rl);
        res.status(response.status).send(response.data != null ? response.data : localErrorMsg);
      } catch (e) {
        res.status(500).send(localErrorMsg);
      }
    });

    let server = app.listen(3031, function () {
      console.log(moment().format('HH:mm:ss'), 'Express server listening on port ' + server.address().port);
    });
    module.exports = app;
  }()
);
