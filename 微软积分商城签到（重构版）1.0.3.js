// ==UserScript==
// @name         微软积分商城签到（重构版）
// @version      1.0.3
// @description  每天在后台自动完成 Microsoft Rewards 任务获取积分奖励，✅签入(PC+App静默)、✅阅读、✅活动、✅搜索、✅Quiz、✅拼图、✅热搜API、✅二次扫描、✅积分通知、✅连签任务检测、✅每日活动自动上报
// @author       kunkun
// @namespace    https://scriptcat.org/users/212527
// @icon         https://rewards.bing.com/rewardscdn/images/rewards/rewards-icon-96.png
// @homepage     https://scriptcat.org/zh-CN/script-show-page/7869
// @updateURL    https://scriptcat.org/scripts/code/7869/微软积分商城签到（重构版）.user.js
// @downloadURL  https://scriptcat.org/scripts/code/7869/微软积分商城签到（重构版）.user.js
// @license      MIT
// @crontab      */20 * * * *
// @connect      bing.com
// @connect      login.live.com
// @connect      login.windows.net
// @connect      login.microsoftonline.com
// @connect      rewards.bing.com
// @connect      prod.rewardsplatform.microsoft.com
// @connect      hotapi.nntool.cc
// @connect      hot.baiwumm.com
// @connect      cnxiaobai.com
// @connect      disp-qryapi.3g.qq.com
// @connect      qyapi.weixin.qq.com
// @connect      oapi.dingtalk.com
// @connect      open.feishu.cn
// @connect      push.i-i.me
// @connect      api.day.app
// @match        https://login.live.com/oauth20_desktop.srf*
// @match        https://rewards.bing.com/*
// @match        https://www.bing.com/*
// @match        https://cn.bing.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_cookie
// @grant        GM_info
// @grant        GM_log
// @grant        GM_registerMenuCommand
// @storageName  BingRewardsAuto_Shared
// @tips         此脚本为开源免费使用，请勿购买
// ==/UserScript==

/* global GM_cookie, GM_getValue, GM_setValue, GM_listValues, GM_deleteValue, GM_xmlhttpRequest, GM_log, GM_info, GM_notification, GM_openInTab */

/* ==UserConfig==
Config:
    keep:
        title: 持续检测（全部完成后是否继续）
        type: checkbox
        default: true
    lock:
        title: 锁定国区（非大陆IP自动停止）
        type: checkbox
        default: true
    api:
        title: 搜索词来源
        type: select
        default: online
        values: [offline, online]
        description: offline 使用内置词库；online 自动轮换热搜接口。
    code:
        title: 授权码链接
        type: textarea
        description: 粘贴 login.live.com 跳转后的完整URL
Tasks:
    sign:
        title: 每日签入
        type: checkbox
        default: true
    read:
        title: 新闻阅读
        type: checkbox
        default: true
    promos:
        title: 活动卡片（含打卡）
        type: checkbox
        default: true
    quiz:
        title: Quiz 活动自动处理
        type: checkbox
        default: true
    search:
        title: PC搜索
        type: checkbox
        default: true
Notice:
    bro:
        title: 浏览器通知（当前脚本）
        type: checkbox
        default: true
    wework:
        title: 企业微信消息推送（群机器人）
        type: text
        password: true
        description: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    dingding:
        title: 钉钉群机器人（不加签，关键词：#）
        type: text
        password: true
        description: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    feishu:
        title: 飞书群机器人（不加签，关键词：#）
        type: text
        password: true
        description: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    pushme:
        title: PushMe（push.i-i.me）
        type: text
        password: true
        description: xxxxxxxxxxxxxxxxxxxx
    bark:
        title: Bark（bark.day.app）
        type: text
        password: true
        description: xxxxxxxxxxxxxxxxxxxx
==/UserConfig== */

// 入口：保存 OAuth 回调后退出；兑换页和视觉搜索页跳过主任务。
// Dashboard 独立处理页面任务；其余页面按路由启动主任务和点击流程。
// 结构：平台与状态 → 解析与服务 → 任务与页面入口。
// 完成依据：搜索/阅读查进度，卡片查服务器，页面点击按 DOM 规则。
// “已尝试”只表示已操作；“待确认”表示结果未知。
(function() {
  'use strict';

  // GM 存储适配，原样返回值或 Promise。
  const Storage = {
    get: (...args) => GM_getValue(...args),
    set: (...args) => GM_setValue(...args),
    remove: (...args) => GM_deleteValue(...args),
    keys: (...args) => GM_listValues(...args)
  };

  // 平台适配：延迟读取浏览器对象。
  const Platform = {
    get location() { return location; },
    get window() { return typeof window === "undefined" ? undefined : window; },
    get document() { return typeof document === "undefined" ? undefined : document; },
    get sessionStorage() { return typeof sessionStorage === "undefined" ? undefined : sessionStorage; },
    get unsafeWindow() { return typeof unsafeWindow === "undefined" ? undefined : unsafeWindow; },
    get navigator() { return typeof navigator === "undefined" ? undefined : navigator; },
    get history() { return typeof history === "undefined" ? undefined : history; },
    get MutationObserver() { return typeof MutationObserver === "undefined" ? undefined : MutationObserver; },
    get info() { return GM_info; },
    request: (...args) => GM_xmlhttpRequest(...args),
    log: (...args) => GM_log(...args),
    notify: (...args) => GM_notification(...args),
    openTab: (...args) => GM_openInTab(...args),
    registerMenu: (...args) => GM_registerMenuCommand(...args),
    cookie: (...args) => GM_cookie(...args),
    prompt: (...args) => prompt(...args),
    alert: (...args) => alert(...args),
    confirm: (...args) => confirm(...args)
  };

  // 处理授权回调，跳过无需启动任务的页面。
  function shouldSkipPage({ Platform, Storage }) {
    // 奖励面板不启动任务。
    if (/^(?:www|cn)\.bing\.com$/i.test(Platform.location.hostname) &&
      /^\/rewards\/panelflyout\/?$/i.test(Platform.location.pathname)) return true;

    if (Platform.location.hostname === "rewards.bing.com" &&
      /^\/(?:api\/getuserinfo|signin|signin-oidc|createuser)\/?$/i.test(Platform.location.pathname)) return true;

    // 保存 OAuth 回调 URL，并清除旧刷新凭据。
    if (Platform.location.hostname === "login.live.com" && Platform.location.pathname === "/oauth20_desktop.srf") {
      const code = new URLSearchParams(Platform.location.search).get("code");
      if (code) {
        Storage.set("Config.code", Platform.location.href);
        Storage.set("Config.token", false);
        if (Storage.get("Notice.bro", true)) {
          try { Platform.notify({ title: "🟢 授权成功", text: "授权码已捕获，可关闭此页" }); } catch(_) {}
        }
        try { Platform.history.replaceState({}, "", "about:blank"); } catch(_) {}
        setTimeout(() => { try { Platform.window.close(); } catch(_) {} }, 200);
      }
      return true;
    }

    // 视觉搜索页不启动主任务，防止递归开页。
    const bingFeatures = new URLSearchParams(Platform.location.search).get("features")
      ?.split(",").map(item => item.trim().toLowerCase()) || [];
    if (/^(?:www\.|cn\.)?bing\.com$/i.test(Platform.location.hostname) && bingFeatures.includes("vsstreak")) return true;
    return false;
  }
  if (shouldSkipPage({ Platform, Storage })) return;

  // 固定配置。
  const RewardsAuto = {
    // 代码和用户设置均开启时才锁区。
    lockRegion: true,

    // 桌面、移动网页和 App 的 User-Agent。
    ua: {
      pc: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
      mobile: "Mozilla/5.0 (Linux; Android 16; Redmi K20 Pro Build/BP4A.251205.006; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Mobile Safari/537.36 EdgA/131.0.0.0",
      app: "Mozilla/5.0 (Linux; Android 16; Redmi K20 Pro Build/BP4A.251205.006; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Mobile Safari/537.36 BingSapphire/32.6.2110003560",
    },
    appConfig: {
      // App 固定参数；阅读服务可改用服务器返回的 offerId。
      rewardsAppId: "SAAndroid/32.6.2110003560",
      channel: "SAAndroid",
      offerIds: {
        readArticle: "ENUS_readarticle3_30points",
      }
    },
    searchPool: [
      "agentic AI tools for everyday work 2026",
      "multimodal AI assistants voice and vision",
      "on device AI laptops comparison 2026",
      "AI smart glasses live translation",
      "generative AI video tools comparison 2026",
      "AI search engines with source citations",
      "digital twins for smart factories",
      "quantum computing breakthroughs 2026",
      "brain computer interface clinical trials 2026",
      "passkeys and passwordless account security",
      "home battery storage systems comparison 2026",
      "solid state EV battery production progress",
      "vehicle to home bidirectional charging",
      "hydrogen fuel cell trucks latest developments",
      "smart rings sleep tracking accuracy",
      "remote patient monitoring wearable devices",
      "assistive technology for independent living",
      "robot lawn mowers navigation comparison",
      "Nintendo Switch 2 best games 2026",
      "handheld gaming PCs battery life comparison",
      "cloud gaming services performance 2026",
      "FIFA World Cup 2026 highlights and best goals",
      "Formula 1 2026 technical regulations explained",
      "Milano Cortina 2026 Winter Olympics highlights",
      "2026 tennis Grand Slam season highlights",
      "James Webb Space Telescope discoveries 2026",
      "Artemis II mission latest updates",
      "sustainable aviation fuel commercial flights",
      "slow travel destinations 2026",
      "2026 science fiction movies and streaming series",
      "2026 十月新番追番指南",
      "2026 热门国漫推荐",
      "动漫角色人气排行",
      "二次元高清动漫壁纸",
      "动漫手办新品与收藏",
      "2026 漫展时间与 Cosplay 展示",
      "原神最新版本活动攻略",
      "崩坏星穹铁道角色配队攻略",
      "绝区零新角色培养建议",
      "鸣潮最新版本探索攻略",
      "2026 Steam 热门游戏推荐",
      "2026 国产单机游戏新作",
      "DeepSeek 最新模型与本地部署",
      "2026 国产开源大模型对比",
      "AI 编程助手代码质量评测",
      "ComfyUI 二次元绘画工作流",
      "AI 动漫角色一致性生成",
      "AI 音乐生成与编曲教程",
      "2026 旗舰手机影像与续航对比",
      "国产显卡与游戏性能评测",
      "宇树机器人最新产品演示",
      "2026 折叠屏手机选购",
      "6G 通信与卫星直连技术",
      "2026 游戏显示器 OLED 与 Mini LED 对比",
      "汉服美女国风写真",
      "旗袍美女人像摄影",
      "2026 女明星红毯造型",
      "气质美女日常穿搭",
      "美女高清手机壁纸",
      "美女人像摄影姿势"
    ],
    // 在线模式自动轮换热搜来源。
    apiConfig: {
      mode: Storage.get("Config.api", "online"),
      sources: [
        {
          url: "https://hot.baiwumm.com/api/",
          hot: ["weibo", "douyin", "baidu", "toutiao", "thepaper", "qq", "netease", "zhihu"],
        },
        {
          url: "https://cnxiaobai.com/DailyHotApi/",
          hot: ["weibo", "douyin", "baidu", "toutiao", "thepaper", "qq-news", "netease-news", "zhihu"],
        },
        {
          url: "https://hotapi.nntool.cc/",
          hot: ["weibo", "douyin", "baidu", "toutiao", "thepaper", "qq-news", "netease-news", "zhihu"],
        },
      ],
    },
    skipPatterns: [
      "referral", "refer and earn", "sweepstake", "entries",
      "install the", "set bing as your default", "bing wallpaper",
      "punch card", "ancient coin", "sea of thieves", "rewards extension",
      "redemption goal", "order history", "claim your gift", "shop to earn",
      "set goal", "Available tomorrow", "Offer is Locked", "Earn -1 points"
    ],
  };

  // 各模块共享的本轮状态。
  // access token 存内存，refresh token 存 Config.token。
  const RunState = {
    token: false,
    region: "CN",
    host: "www.bing.com",
    dateNowNum: 0,
    dateNowStr: "",
    ipInfo: "",
    startTime: 0,
    forceRun: false,
  };

  // 搜索进度与热搜缓存。
  const SearchState = {
    lastSearchProgress: -1, restrictedTimes: 0, searchTrackingDate: undefined,
    wordList: [], wordIndex: 0

  };
  const ReadingState = { progress: 0, max: 30 };

  // 通知渠道定义；发送时读取配置。
  const Webhooks = [
    {
      name: "企业微信",
      url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=",
      storageKey: "Notice.wework", configName: "企业微信 Webhook",
      hint: "群机器人webhook key",
      buildMessage: message => ({
        "msgtype": "text",
        "text": {
          "content": `> ${new Date().toLocaleString()}\n\n ## ${Platform.info.script.name}\n ${message}`
        },
      }),
    },
    {
      name: "钉钉",
      url: "https://oapi.dingtalk.com/robot/send?access_token=",
      storageKey: "Notice.dingding", configName: "钉钉机器人 Access Token",
      hint: "不加签，关键词需包含 #",
      buildMessage: message => ({
        "msgtype": "markdown",
        "markdown": {
          "title": Platform.info.script.name,
          "text": `> ${new Date().toLocaleString()}\n ### ${Platform.info.script.name}\n ${message}`
        },
      }),
    },
    {
      name: "飞书",
      url: "https://open.feishu.cn/open-apis/bot/v2/hook/",
      storageKey: "Notice.feishu", configName: "飞书机器人 Webhook",
      hint: "不加签，关键词需包含 #",
      buildMessage: message => ({
        "msg_type": "interactive",
        "card": {
          "schema": "2.0",
          "header": {
            "title": {
              "tag": "plain_text",
              "content": Platform.info.script.name
            },
            "template": "orange"
          },
          "body": {
            "elements": [{
              "tag": "markdown",
              "text_align": "center",
              "content": `#### ${new Date().toLocaleString()}\n ${message}`
            }]
          }
        }
      }),
    },
    {
      name: "PushMe",
      url: "https://push.i-i.me/?push_key=",
      storageKey: "Notice.pushme", configName: "PushMe Key",
      hint: "push.i-i.me 推送key",
      buildMessage: message => ({
        "type": "markdown",
        "title": `${Platform.info.script.name}[#rewards!https://rewards.bing.com/rewards.png]`,
        "content": `\n ${message}`
      }),
    },
    {
      name: "Bark",
      url: "https://api.day.app/",
      storageKey: "Notice.bark", configName: "Bark Key",
      hint: "bark.day.app 推送key",
      buildMessage: message => ({
        "group": "rewards",
        "icon": "https://rewards.bing.com/rewards.png",
        "title": Platform.info.script.name,
        "markdown": `\n ${message}`
      }),
    },
  ];

  // 运行锁状态，供 RunGuard 和 TaskRunLock 共用。
  const LockState = {
    prefix: "Config.taskRunLock.", releasedPrefix: "Config.taskRunReleased.",
    pageExitStorageKey: "RewardsAuto.taskRunPageExit",
    ttl: 10 * 60 * 1000, heartbeatMs: 30000,
    key: "", id: "", held: false, lost: false, acquiring: false,
    timer: null, renewing: null, pageLeaving: false, pageExitListener: null

  };

  // 纯数据解析，无网络或存储操作。
  const DataParsers = {
    // 有效用户数据须含可识别积分，且无明确未登录标记。
    validUserInfo(data) {
      if (!data || typeof data !== "object" || Array.isArray(data)) return false;
      const dashboard = data.dashboard || data, status = dashboard.userStatus;
      if (!status || typeof status !== "object" || Array.isArray(status)) return false;
      if ([data, dashboard, status].some(item =>
        ["isAuthenticated", "isSignedIn", "isLoggedIn"].some(key => item[key] === false))) return false;
      const points = status.availablePoints ?? dashboard.availablePoints ?? data.balance;
      return (typeof points === "number" || typeof points === "string" && /^\d+$/.test(points)) &&
        Number.isSafeInteger(Number(points)) && Number(points) >= 0;
    },

    booleanFlag(value) {
      return value === true || value === "true" || value === 1 || value === "1"
        ? true : value === false || value === "false" || value === 0 || value === "0" ? false : null;
    },

    // 仅解析非负安全整数。
    parseNonNegativeInteger(value, trimString = true) {
      if (typeof value !== "number" && typeof value !== "string") return NaN;
      if (typeof value === "string" && !/^\d+$/.test(trimString ? value.trim() : value)) return NaN;
      const number = Number(value);
      return Number.isSafeInteger(number) && number >= 0 ? number : NaN;
    },

    // 取首个有效余额；允许 0，全无效时返回 null。
    accountBalance(...values) {
      for (const value of values) {
        const balance = DataParsers.parseNonNegativeInteger(value);
        if (Number.isFinite(balance)) return balance;
      }
      return null;
    },

    userInfoBalance(data) {
      const dashboard = data?.dashboard || data;
      return this.accountBalance(dashboard?.userStatus?.availablePoints, dashboard?.availablePoints, data?.balance);
    },

    dapiBalance(response) {
      return this.accountBalance(response?.balance, response?.userStatus?.availablePoints);
    },

    sumSearchCounters(items) {
      if (!Array.isArray(items)) return { progress: 0, max: 0 };
      return items.reduce((acc, item) => {
        acc.progress += Number(item?.pointProgress || 0);
        acc.max += Number(item?.pointProgressMax || item?.pointMax || 0);
        return acc;
      }, { progress: 0, max: 0 });
    },

    // 解码 Flight 字符串分片，不执行页面脚本。
    flightChunks(html) {
      return [...String(html || "").matchAll(
        /self\.__next_f\.push\(\s*\[\s*1\s*,\s*("(?:\\.|[^"\\])*")\s*\]\s*\)/g
      )].map(match => {
        try { return JSON.parse(match[1]); } catch (_) { return ""; }
      });
    },

    // 按 partner、活动计数和当日标记识别连签，忽略公共文案。
    parseStreakData(html) {
      const tasks = new Map();
      let bonus = null;
      const visit = value => {
        if (!value || typeof value !== "object") return;
        if (!Array.isArray(value)) {
          const partner = String(value.partner || "").trim().toLowerCase();
          const completed = Number(value.activitiesCompleted);
          const total = Number(value.activitiesTotal);
          if (partner && Number.isFinite(completed) && Number.isFinite(total) &&
            Object.prototype.hasOwnProperty.call(value, "isCurrentDayCompleted")) {
            tasks.set(partner, {
              partner,
              title: String(value.title || ""),
              activitiesCompleted: completed,
              activitiesTotal: total,
              completedDays: Number(value.completedDays),
              totalDays: Number(value.totalDays),
              isCurrentDayCompleted: value.isCurrentDayCompleted === true,
              isEnabled: value.isEnabled !== false
            });
          }

          const stampProgress = Number(value.activityProgress);
          const stampTotal = Number(value.activitiesTotal);
          const reward = Number(value.streakBonus);
          if (!partner && Number.isFinite(stampProgress) && Number.isFinite(stampTotal) &&
            stampTotal > 0 && Number.isFinite(reward)) {
            bonus = { progress: stampProgress, total: stampTotal, reward };
          }
        }
        for (const child of Object.values(value)) visit(child);
      };

      const flight = DataParsers.flightChunks(html).join("");

      for (const line of flight.split("\n")) {
        const record = line.match(/^[a-f0-9]+:(.*)$/i);
        if (!record) continue;
        try { visit(JSON.parse(record[1])); } catch (_) {}
      }
      return { tasks: [...tasks.values()], bonus };
    }
  };

  /**
   * 搜索配额与查询状态。
   * @typedef {Object} SearchProgress
   * @property {number} progress 已获积分。
   * @property {number} max 积分上限；0 不能确认完成。
   * @typedef {Object} SearchQuotaResult
   * @property {"available"|"zero"|"missing"|"unknown"|"failed"} status 数据可用状态。
   * @property {string} source 数据来源。
   * @property {SearchProgress|null} pc PC 配额，无效时为 null。
   * @property {SearchProgress|null} mobile 移动端配额；主任务仅执行 PC 搜索。
   */
  const SearchQuota = {
    /**
     * 创建含数据来源的查询结果。
     * @param {SearchQuotaResult["status"]} status
     * @param {string} source
     * @param {SearchProgress|null} [pc=null]
     * @param {SearchProgress|null} [mobile=null]
     * @returns {SearchQuotaResult}
     */
    create(status, source, pc = null, mobile = null) {
      return { status, source, pc, mobile };
    },

    // 搜索执行、受限判断和汇总共用此配额检查。
    hasProgress(value) {
      return Number.isFinite(value?.pc?.progress) && value.pc.progress >= 0
        && Number.isFinite(value.pc.max) && value.pc.max > 0;
    },

    // 区分缺失、异常和 0/0；仅正上限为 available。
    fromPC(value, source, mobile = null) {
      if (value === undefined) return this.create("missing", source);
      const progress = DataParsers.parseNonNegativeInteger(value?.progress);
      const max = DataParsers.parseNonNegativeInteger(value?.max);
      if (!Number.isFinite(progress) || !Number.isFinite(max) || (max === 0 && progress !== 0)) {
        return this.create("unknown", source);
      }
      return this.create(max > 0 ? "available" : "zero", source, { progress, max }, mobile);
    },

    fromCounters(items, source) {
      if (items === undefined || Array.isArray(items) && items.length === 0) return this.create("missing", source);
      if (!Array.isArray(items)) return this.create("unknown", source);
      for (const item of items) {
        const max = (item?.pointProgressMax || item?.pointMax) ?? item?.pointProgressMax;
        if (!Number.isFinite(DataParsers.parseNonNegativeInteger(item?.pointProgress))
          || !Number.isFinite(DataParsers.parseNonNegativeInteger(max))) return this.create("unknown", source);
      }
      return this.fromPC(DataParsers.sumSearchCounters(items), source);
    },

    // 优先选可用配额，异常结果不覆盖有效结果。
    select(results) {
      for (const status of ["available", "zero", "unknown", "missing", "failed"]) {
        const found = results.find(result => result.status === status);
        if (found) return found;
      }
      return this.create("unknown", "none");
    }
  };

  // 从 HTML/Flight 提取配额、余额和汇总数据。
  const RewardsPage = {
    prepare(html) {
      const flight = DataParsers.flightChunks(html);
      return { html, text: flight.length ? flight.join("") : html.replace(/\\"/g, '"') };
    },

    // 按括号和引号截取 JSON，跳过字符串内的括号。
    field(text, name) {
      const match = new RegExp(`"${name}"\\s*:\\s*`).exec(text);
      if (!match) return undefined;
      const start = match.index + match[0].length;
      if (text[start] !== "{" && text[start] !== "[") return null;
      let depth = 0, quoted = false, escaped = false;
      for (let index = start; index < text.length; index++) {
        const char = text[index];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') quoted = false;
          continue;
        }
        if (char === '"') quoted = true;
        else if (char === "{" || char === "[") depth++;
        else if (char === "}" || char === "]") {
          if (--depth === 0) {
            try { return JSON.parse(text.slice(start, index + 1)); } catch (_) { return null; }
          }
        }
      }
      return null;
    },

    // 配额来源：结构化 PC 数据、页面表格、combinedSearch。
    searchQuota(page) {
      const counters = this.field(page.text, "pointsCounters");
      const mobile = SearchQuota.fromPC(counters?.mobile, "page").pc;
      const primary = counters === null ? SearchQuota.create("unknown", "page")
        : SearchQuota.fromPC(counters?.pc, "page", mobile);
      if (primary.status === "available") return primary;
      const candidates = [primary];
      const row = page.html.match(/<p>\s*必应搜索\s*<\/p>\s*<\/div>\s*<div(?=[^>]*justify-self-end)[^>]*>([\s\S]{0,500}?)<\/div>/i);
      const table = row && (row[1].match(/<span[^>]*>([\d,]+)<\/span>\s*<span[^>]*>\s*\/\s*([\d,]+)\s*<\/span>/i)
        || row[1].match(/([\d,]+)\s*\/\s*([\d,]+)/));
      if (table) candidates.push(SearchQuota.fromPC({
        progress: table[1].replace(/,/g, ""), max: table[2].replace(/,/g, "")
      }, "page-table", mobile));
      candidates.push(SearchQuota.fromPC(this.field(page.text, "combinedSearch"), "page-combined", mobile));
      return SearchQuota.select(candidates);
    },

    balance(page) {
      for (const field of ["availablePoints", "balance"]) {
        const pattern = new RegExp(`"${field}"\\s*:\\s*(?:"\\s*(\\d+)\\s*"|(\\d+))(?=\\s*[,}])`);
        const match = page.text.match(pattern);
        const balance = DataParsers.accountBalance(match?.[1], match?.[2]);
        if (balance !== null) return balance;
      }
      return null;
    },

    dailyOffer(page) {
      const counters = this.field(page.text, "pointsCounters");
      const points = DataParsers.parseNonNegativeInteger(counters?.dailyOffer);
      return Number.isFinite(points) ? points : 0;
    },

    activityDetails(page, pageQuota, dailyOffer) {
      const details = [];
      const visit = value => {
        if (!value || typeof value !== "object") return;
        const points = DataParsers.parseNonNegativeInteger(value.points);
        if (typeof value.title === "string" && value.isCompleted === true && points > 0) {
          details.push({ title: value.title, points });
        }
        for (const child of Object.values(value)) visit(child);
      };
      visit(this.field(page.text, "activityCards"));
      if (["page-table", "page-combined"].includes(pageQuota.source) && pageQuota.pc) {
        details.push({ title: "必应搜索", points: pageQuota.pc.progress, max: pageQuota.pc.max });
      }
      if (dailyOffer > 0) details.push({ title: "优惠", points: dailyOffer });
      const pattern = /<p>([^<]+)<\/p><\/div><div[^>]*>(\d+)<\/div>/g;
      let match;
      while ((match = pattern.exec(page.html)) !== null) {
        const points = parseInt(match[2], 10);
        if (points > 0 && !details.some(detail => detail.title === match[1])) details.push({ title: match[1], points });
      }
      return details;
    },

    history(page) {
      const structured = this.field(page.text, "pointsHistory");
      const history = {};
      for (const [key, field, label, legacyField] of [
        ["month", "thisMonth", "本月", "monthlyPoints"],
        ["year", "thisYear", "今年", "yearlyPoints"],
        ["lifetime", "lifetime", "生存期", "lifetimePoints"]
      ]) {
        const htmlMatch = page.html.match(new RegExp(`${label}.*?(\\d[\\d,]*)<\\/div>`));
        const jsonMatch = page.text.match(new RegExp(`"${legacyField}":(\\d+)`));
        history[key] = DataParsers.accountBalance(structured?.[field]?.earn,
          htmlMatch?.[1].replace(/,/g, ""), jsonMatch?.[1]) ?? 0;
      }
      return history;
    }
  };

  const isDashboardPage = typeof Platform.location !== "undefined" &&
    Platform.location.hostname === "rewards.bing.com" && /^\/dashboard\/?$/.test(Platform.location.pathname);

  /**
   * 本次执行结果，独立于完成日期和服务器进度。
   * @typedef {Object} TaskExecutionResult
   * @property {"completed"|"pending"|"failed"|"unknown"|"skipped"} status 执行状态。
   * @property {string} reason 非空原因标识。
   * @property {boolean} retryable 是否允许本轮重试。
   */
  const TaskResult = {
    /**
     * 默认不重试；completed/skipped 始终不可重试。
     * @param {TaskExecutionResult["status"]} status
     * @param {string} reason
     * @param {boolean} [retryable=false]
     * @returns {TaskExecutionResult}
     */
    create(status, reason, retryable = false) {
      return { status, reason, retryable: retryable === true && ["pending", "failed", "unknown"].includes(status) };
    },

    isValid(result) {
      return !!result && ["completed", "pending", "failed", "unknown", "skipped"].includes(result.status)
        && typeof result.reason === "string" && result.reason.length > 0
        && typeof result.retryable === "boolean";
    }
  };

  /**
   * 汇总所需的只读快照，由调用方准备。
   * @typedef {Object} RunSummaryInput
   * @property {{balance?: number|null, pc?: SearchProgress|null, readProgress?: number, readMax?: number}} info 最终查询结果。
   * @property {number|null} startBalance 初始余额，未知为 null。
   * @property {number|null} endBalance 结束余额，无效时取 info.balance。
   * @property {number} today 本轮本地日期，YYYYMMDD。
   * @property {{signDate: number, readDate: number, promosDate: number, streakDays: number}} tasks 任务日期与连签天数。
   * @property {SearchProgress} read 阅读进度的兜底值。
   * @property {boolean} promosEnabled 活动卡片开关。
   */
  // 汇总格式器：只读快照，返回通知文本。
  const RunSummary = {
    /**
     * 将任务和余额快照转为通知文本。
     * @param {RunSummaryInput} input 汇总快照。
     * @returns {string} 通知文本。
     */
    format({ info, startBalance, endBalance, today, tasks, read, promosEnabled }) {
      // 余额查询优先，页面余额兜底；任一端未知则不算增量。
      const finalBalance = DataParsers.accountBalance(endBalance, info.balance);
      const earned = startBalance !== null && finalBalance !== null ? finalBalance - startBalance : null;
      const earnedText = earned === null ? "未确认" : `${earned >= 0 ? "+" : ""}${earned}`;

      const signOk = tasks.signDate === today;
      const readOk = tasks.readDate === today;
      const searchKnown = SearchQuota.hasProgress(info);
      const searchOk = searchKnown && info.pc.progress >= info.pc.max;
      const promosOk = tasks.promosDate === today;
      const readProgress = Number.isFinite(info.readProgress)
        ? info.readProgress : read.progress;
      const readMax = Number.isFinite(info.readMax) && info.readMax > 0
        ? info.readMax : read.max;

      let logMsg = `签到\t\t${signOk ? '✅' : '❌'}\n`;
      logMsg += `阅读\t\t${readOk ? '✅' : '❌'} ${readProgress}/${readMax}\n`;
      logMsg += `PC 搜索\t${searchKnown ? `${searchOk ? '✅' : '⏳'} ${info.pc.progress}/${info.pc.max}` : '⏳ 配额未确认'}\n`;
      logMsg += `活动卡片\t${!promosEnabled ? '已关闭' : promosOk ? '✅' : '⏳ 未完成/待确认'}\n`;
      logMsg += `连签\t\t${tasks.streakDays || 0} 天\n`;
      logMsg += `本轮获取\t${earnedText}\n`;
      logMsg += `总积分\t\t${finalBalance ?? "未确认"}`;
      return logMsg;
    }
  };

  // 任务日期、重试次数和卡片尝试记录。
  const TaskState = {
    signDate: 0, readDate: 0, promosDate: 0, searchDate: 0, streakDays: 0,
    signPoint: -1, signTimes: 0, readTimes: 0,
    cardAttempted: new Set(), cardResults: new Map()

  };

  // 所有模块初始化后再启动入口。
  // 底层传输不做登录检查，供 Bing 探针调用。
  const HttpTransport = {
    send(options) {
      return { handle: Platform.request(options) };
    },

    // 返回文本或完整响应；HTTP 失败抛出带 status 的错误。
    text(options, onResponse = null) {
      const { fullResponse = false, ...requestOptions } = options;
      return new Promise((resolve, reject) => {
        const start = Date.now();
        this.send({
          anonymous: false, ...requestOptions, timeout: 15000,
          onload: async response => {
            try {
              if (onResponse) await onResponse();
              const cost = ((Date.now() - start) / 1000).toFixed(2);
              if (response.status >= 200 && response.status < 300) {
                resolve(fullResponse ? response : response.responseText);
              } else if ([301, 302, 307, 308].includes(response.status)) {
                const match = response.responseHeaders?.match(/Location:\s*(.*?)\s*\r?\n/i);
                resolve(fullResponse ? response : match ? match[1] : false);
              } else {
                reject(Object.assign(new Error(`HTTP ${response.status}，用时 ${cost} 秒`), { status: response.status }));
              }
            } catch (error) { reject(error); }
          },
          onerror: error => {
            const cost = ((Date.now() - start) / 1000).toFixed(2);
            reject(new Error(`${error?.error || "网络错误"}，用时 ${cost} 秒`));
          },
          ontimeout: () => {
            const cost = ((Date.now() - start) / 1000).toFixed(2);
            reject(new Error(`请求超时，用时 ${cost} 秒`));
          }
        });
      });
    },

    // 恢复请求设独立超时，所有回调只结算一次。
    response(options, timeout, errorFor) {
      return new Promise((resolve, reject) => {
        let finished = false, transport;
        const timeoutMs = Math.max(1, Math.min(15000, timeout));
        const settle = (callback, value) => {
          if (finished) return;
          finished = true;
          clearTimeout(watchdog);
          callback(value);
        };
        const watchdog = setTimeout(() => {
          settle(reject, errorFor("timeout"));
          try { transport?.handle?.abort?.(); } catch (_) {}
        }, timeoutMs);
        try {
          transport = this.send({
            method: "GET", ...options, anonymous: false, timeout: timeoutMs,
            onload: response => settle(resolve, response),
            onerror: () => settle(reject, errorFor("network")),
            ontimeout: () => settle(reject, errorFor("timeout")),
            onabort: () => settle(reject, errorFor("abort"))
          });
          if (transport.handle && typeof transport.handle.catch === "function") {
            transport.handle.catch(() => settle(reject, errorFor("dispatch")));
          }
        } catch (error) { settle(reject, errorFor("dispatch", error)); }
      });
    },

    async fetch(pageWindow, url, options) {
      return pageWindow.fetch(url, options);
    }
  };

  // 登录代次与停止状态；确认退出后清理凭据和任务。
  const SessionGuard = {
    stopped: false, logoutCleared: false,
    resetId: Storage.get("Config.sessionResetId", ""),

    error() {
      return Object.assign(new Error("网页登录检查未通过，任务已停止"), { code: "WEB_SESSION_STOPPED" });
    },

    isStopped() {
      if (!this.stopped && Storage.get("Config.sessionResetId", "") !== this.resetId) {
        this.stop("其他页面已退出登录");
      }
      return this.stopped;
    },

    stop(reason, confirmedLogout = false) {
      const firstStop = !this.stopped;
      const firstLogout = confirmedLogout && !this.logoutCleared;
      if (firstStop || firstLogout) {
        this.stopped = true;
        RunState.token = false;
        ReadingState.progress = 0;
        if (firstLogout) {
          this.logoutCleared = true;
          // 仅确认退出时清理持久数据；状态不明只停本实例。
          const cleared = {
            "Config.token": false, "Config.tokenTime": 0, "Config.code": "",
            "Config.tasks": {}, "Config.signPoint": -1,
            "Config.dailySetCompleted": 0, "Config.dailySetProcessed": [],
            "Config.punchCardDetailDate": 0, "Config.punchCardDetailState": 0,
            "Config.punchCardDate": 0, "Config.punchCardState": 0,
            "Config.lastSearchProgress": -1, "Config.restrictedTimes": 0, "Config.searchTrackingDate": 0
          };
          for (const [key, value] of Object.entries(cleared)) Storage.set(key, value);
          // 更新登录代次，使其他页面在下个检查点停止旧任务。
          Storage.set("Config.sessionResetId", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        }
        Platform.log(`🔒 ${reason}，已停止全部任务。请确认 Bing 登录后刷新重试。`);
      }
      return this.error();
    }
  };

  // 基础日志；推送由 Notice 处理。
  const Logger = {
    log(icon, msg) {
      if (SessionGuard.isStopped()) return false;
      Platform.log(icon + " " + msg);
      return true;
    }
  };

  // 配置、日期、随机数和 JSON 工具。
  const Utils = {
    isRegionLockEnabled() {
      if (RewardsAuto.lockRegion !== true) return false;
      // 兼容布尔、数字及字符串形式的关闭设置。
      const saved = Storage.get("Config.lock", true);
      if (typeof saved === "string") {
        const value = saved.trim().toLowerCase();
        if (value === "false" || value === "0") return false;
      }
      return saved !== false && saved !== 0;
    },

    randomRange(min, max) {
      return Math.floor(Math.random() * (max - min + 1) + min);
    },

    // 任务按本地日历日记录 YYYYMMDD，避免 UTC 换日偏差。
    getTodayNum() {
      const d = new Date();
      return Number(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`);
    },

    getTodayStr() {
      const d = new Date();
      return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
    },

    getRandomUUID() {
      return crypto.randomUUID().replace(/-/g, "").toUpperCase();
    },

    isJSON(s) {
      try { const j = JSON.parse(s); return Array.isArray(j) || (typeof j === "object" && j !== null); }
      catch { return false; }
    }
  };

  // 仅主任务启用：跨本地午夜中止旧轮次。
  const RunDateGuard = {
    date: 0,
    begin(date = Utils.getTodayNum()) { this.date = date; },
    end() { this.date = 0; },
    hasChanged() { return this.date !== 0 && this.date !== Utils.getTodayNum(); },
    assertCurrent() {
      if (this.hasChanged()) {
        throw Object.assign(new Error("日期已变化，停止本轮任务，等待下一轮重新核验"), { code: "TASK_RUN_DATE_CHANGED" });
      }
    }
  };

  // 统一检查会话、运行锁和日期。
  const RunGuard = {
    // 会话停止、失锁和跨日须继续向上抛出。
    isStopError(error) {
      return error?.code === "WEB_SESSION_STOPPED" || error?.code === "TASK_RUN_LOCK_LOST"
        || error?.code === "TASK_RUN_DATE_CHANGED";
    },

    markLockLost() {
      if (!LockState.lost) Platform.log("🟡 主任务运行锁已失效，已停止本轮任务");
      LockState.lost = true;
    },

    // 核验共享租约；过期、撤销或离页时中止。
    assertLock() {
      if (LockState.pageLeaving) {
        throw Object.assign(new Error("页面已刷新或离开，本页任务已停止"), { code: "TASK_RUN_LOCK_LOST" });
      }
      if (!LockState.held) return;
      const record = Storage.get(LockState.key, null);
      if (LockState.lost || Number(Storage.get(LockState.releasedPrefix + LockState.id, 0)) > Date.now()
        || record?.id !== LockState.id || !Number.isFinite(Number(record?.expiresAt))
        || Number(record.expiresAt) <= Date.now()) {
        this.markLockLost();
        throw Object.assign(new Error("主任务运行锁已失效"), { code: "TASK_RUN_LOCK_LOST" });
      }
    },

    assertActive() {
      if (SessionGuard.isStopped()) throw SessionGuard.error();
      RunGuard.assertLock();
      RunDateGuard.assertCurrent();
    }
  };

  // Bing 登录探测，合并并发请求。
  const WebSession = {
    checking: null, verified: false,

    isWebRequest(url) {
      const host = new URL(url).hostname;
      return ["rewards.bing.com", "www.bing.com", "cn.bing.com", "bing.com"].includes(host);
    },

    isBingHost(host) {
      return ["www.bing.com", "cn.bing.com", "bing.com"].includes(host);
    },

    probeUrl() {
      const current = typeof Platform.location !== "undefined" ? Platform.location.hostname : "";
      const host = this.isBingHost(current) ? current
        : this.isBingHost(RunState.host) ? RunState.host : "www.bing.com";
      return `https://${host}/?_rauto_session=${Date.now()}`;
    },

    needsLogin(url) {
      const host = new URL(url).hostname;
      return this.isWebRequest(url) || ["prod.rewardsplatform.microsoft.com", "login.live.com"].includes(host);
    },

    // 用新获取的 Bing 页面判断登录、退出或未知。
    readBingLogin(html) {
      const markup = String(html || "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
      const nodes = [...markup.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)];
      const attribute = (node, name) => {
        const match = node?.[0].match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', "i"));
        return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "")
          .replace(/&quot;|&#34;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&amp;/gi, "&");
      };
      const byId = id => nodes.find(node => attribute(node, "id") === id);
      const visible = node => !!node && attribute(node, "aria-hidden") !== "true"
        && !/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attribute(node, "style"))
        && !/(?:^|\s)b_hide(?:\s|$)/.test(attribute(node, "class"))
        && !/\shidden(?:\s|=|>)/i.test(node[0]);
      const text = node => {
        if (!node) return "";
        const start = node.index + node[0].length;
        const rest = markup.slice(start, start + 2000);
        const end = rest.search(new RegExp('</' + node[1] + '\\s*>', "i"));
        return end < 0 ? "" : rest.slice(0, end).replace(/<[^>]*>/g, "")
          .replace(/&nbsp;|&#160;/gi, " ").trim();
      };
      const name = byId("id_n"), signIn = byId("id_s");
      const accountVisible = visible(name) && !!text(name);
      const signInVisible = visible(signIn) && !!text(signIn);
      const medal = byId("rh_rwm") || nodes.find(node => attribute(node, "data-rewards-widget") === "medallion");
      let rewardsSignedIn = false;
      const raw = attribute(medal, "data-content");
      if (raw) {
        try {
          const content = JSON.parse(raw.trim().startsWith("{") ? raw : atob(raw));
          // 非 Rewards 成员不代表已退出 Bing。
          rewardsSignedIn = content.isRewardsUser === true || content.isAccountLogin === true;
        } catch (_) {}
      }
      const positive = accountVisible || rewardsSignedIn;
      const state = positive && !signInVisible ? "signed-in"
        : signInVisible && !positive ? "signed-out" : "unknown";
      return { state, accountVisible, signInVisible, rewardsSignedIn };
    },

    // 仅复用在途探针；结束后下次重新请求。
    async ensure() {
      RunGuard.assertActive();
      if (this.checking) return this.checking;
      this.checking = (async () => {
        const url = this.probeUrl();
        try {
          const response = await HttpTransport.text({
            url, fullResponse: true,
            headers: { "cache-control": "no-cache", "user-agent": RewardsAuto.ua.pc, "referer": new URL(url).origin + "/" }
          });
          RunGuard.assertActive();
          const destination = new URL(response.finalUrl || url);
          if (["login.live.com", "login.microsoftonline.com"].includes(destination.hostname)
            || this.isBingHost(destination.hostname) && /^\/fd\/auth\/(?:signin|signout)(?:\/|$)/i.test(destination.pathname)) {
            throw SessionGuard.stop("Bing 网页已退出登录", true);
          }
          if (!this.isBingHost(destination.hostname)) throw SessionGuard.stop("Bing 登录检查跳转到了其他网站");
          const login = this.readBingLogin(response.responseText);
          if (login.state === "signed-out") throw SessionGuard.stop("Bing 网页已退出登录", true);
          if (login.state !== "signed-in") {
            throw SessionGuard.stop("Bing 页面未提供明确的登录状态，暂时无法确认");
          }
          RunGuard.assertActive();
          if (!this.verified) {
            this.verified = true;
            Logger.log("🟢", "Bing 网页登录已确认");
          }
          return true;
        } catch (e) {
          if (RunGuard.isStopError(e)) throw e;
          // 网络或页面异常只停止任务，不清除授权。
          throw SessionGuard.stop(`暂时无法确认 Bing 登录状态${e.status ? `（HTTP ${e.status}）` : ""}`);
        }
      })();
      try { return await this.checking; }
      finally { this.checking = null; }
    }
  };

  // 受保护请求前后检查 Bing 登录，并核验锁和日期。
  const HttpClient = {
    async text(options) {
      const { sessionProbe = false, ...requestOptions } = options;
      const protectedRequest = WebSession.needsLogin(requestOptions.url);
      if (!sessionProbe) {
        RunGuard.assertActive();
        if (protectedRequest) await WebSession.ensure();
        RunGuard.assertActive();
      }
      return HttpTransport.text(requestOptions, sessionProbe ? null : async () => {
        RunGuard.assertActive();
        if (protectedRequest) await WebSession.ensure();
        RunGuard.assertActive();
      });
    },

    // 认证请求保留状态、重定向和响应内容。
    async recovery(options, timeout = 15000) {
      await WebSession.ensure();
      const messages = { timeout: "getuserinfo 后台请求超时", network: "getuserinfo 网络请求失败",
        abort: "getuserinfo 请求已取消", dispatch: "getuserinfo 请求无法发出" };
      const response = await HttpTransport.response(options, timeout,
        (event, error) => RunGuard.isStopError(error) ? error : new Error(messages[event]));
      await WebSession.ensure();
      return response;
    },

    // 使用 Dashboard 的 fetch，读完响应再查登录。
    async fetchText(pageWindow, url, options) {
      const response = await HttpTransport.fetch(pageWindow, url, options);
      RunGuard.assertActive();
      const responseText = await response.text();
      await WebSession.ensure();
      return { response, responseText };
    }
  };

  // 带运行检查的延时与 DOM 等待。
  const Wait = {
    // 等待前后检查停止、失锁和跨日。
    delay(ms) {
      RunGuard.assertActive();
      return new Promise((resolve, reject) => setTimeout(() => {
        try { RunGuard.assertActive(); resolve(); }
        catch (e) { reject(e); }
      }, ms));
    },

    // 随机等待，默认 3～8 秒，参数单位为毫秒。
    randomDelay(min = 3000, max = 8000) {
      return this.delay(Utils.randomRange(min, max));
    },

    // 统一处理初查、DOM 变化和超时复查。
    until(query, matched, timeout, errorMessage) {
      return new Promise((resolve, reject) => {
        const initial = query();
        if (matched(initial)) return resolve(initial);
        const observer = new Platform.MutationObserver((_, obs) => {
          const value = query();
          if (matched(value)) { obs.disconnect(); resolve(value); }
        });
        observer.observe(Platform.document.body, { childList: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          const value = query();
          matched(value) ? resolve(value) : reject(new Error(errorMessage));
        }, timeout);
      });
    },

    element(selector, timeout = 30000) {
      return this.until(() => Platform.document.querySelector(selector), Boolean, timeout, "等待元素超时: " + selector);
    },

    elementsByText(containerSelector, textPatterns, timeout = 30000) {
      const findElements = () => {
        const containers = Platform.document.querySelectorAll(containerSelector);
        const results = [];
        for (const container of containers) {
          const text = container.textContent || "";
          for (const pattern of textPatterns) {
            if (text.includes(pattern)) {
              results.push({ element: container, pattern });
              break;
            }
          }
        }
        return results;
      };
      return this.until(findElements, found => found.length > 0, timeout, "等待文本元素超时");
    }
  };

  // 跨页运行锁：选号、续租和离页清理。
  const TaskRunLock = {
    installPageExitHandler() {
      if (LockState.pageExitListener || typeof Platform.window === "undefined"
        || typeof Platform.window.addEventListener !== "function") return;
      LockState.pageExitListener = event => {
        // 往返缓存保留实例；普通离页撤销运行权。
        if (event.persisted !== true) this.handlePageExit();
      };
      Platform.window.addEventListener("pagehide", LockState.pageExitListener);
    },

    revokeLease(record) {
      const pending = [];
      // 离页时立即写撤销标记，阻止迟到的续租。
      try { pending.push(Storage.set(LockState.releasedPrefix + record.id, record.expiresAt)); }
      catch (e) { pending.push(Promise.reject(e)); }
      try {
        if (Storage.get(record.key, null)?.id === record.id) pending.push(Storage.remove(record.key));
      } catch (e) { pending.push(Promise.reject(e)); }
      return Promise.all(pending);
    },

    handlePageExit() {
      if (LockState.pageLeaving) return;
      Startup.cancelRetry();
      LockState.pageLeaving = LockState.lost = true;
      LockState.held = false;
      if (LockState.timer !== null) clearTimeout(LockState.timer);
      LockState.timer = null;
      if (!LockState.key || !LockState.id) return;

      const record = { key: LockState.key, id: LockState.id, expiresAt: Date.now() + LockState.ttl };
      // 暂存离页记录，刷新后补做撤销。
      try { Platform.sessionStorage.setItem(LockState.pageExitStorageKey, JSON.stringify(record)); } catch (_) {}
      this.revokeLease(record).catch(() => {});
    },

    async clearPageExitLock() {
      let raw, record;
      try {
        raw = Platform.sessionStorage.getItem(LockState.pageExitStorageKey);
        if (!raw) return;
        record = JSON.parse(raw);
      } catch (_) { return; }
      const valid = typeof record?.id === "string" && record.id
        && record.key === LockState.prefix + record.id && Number.isFinite(record.expiresAt)
        && record.expiresAt > Date.now();
      if (valid) {
        // 刷新后补撤销旧锁，弥补离页写入未完成。
        await this.revokeLease(record);
        RunGuard.assertActive();
        Platform.log("📄 已清理刷新前的本页运行锁");
      }
      try {
        if (Platform.sessionStorage.getItem(LockState.pageExitStorageKey) === raw) Platform.sessionStorage.removeItem(LockState.pageExitStorageKey);
      } catch (_) {}
    },

    // 读取同一登录代次的有效候选，清理失效记录。
    async records() {
      const now = Date.now();
      const allKeys = await Storage.keys();
      const released = new Set();
      await Promise.all(allKeys.filter(key => key.startsWith(LockState.releasedPrefix)).map(async key => {
        const expiresAt = Number(await Storage.get(key, 0));
        if (Number.isFinite(expiresAt) && expiresAt > now) {
          released.add(key.slice(LockState.releasedPrefix.length));
        } else {
          await Storage.remove(key);
        }
      }));
      const records = await Promise.all(allKeys.filter(key => key.startsWith(LockState.prefix)).map(async key => {
        const record = await Storage.get(key, null);
        if (!record || record.id !== key.slice(LockState.prefix.length)) return null;
        // 撤销标记优先，迟到续租不能恢复运行权。
        if (released.has(record.id) || !Number.isFinite(Number(record.expiresAt))
          || record.sessionResetId !== SessionGuard.resetId || Number(record.expiresAt) + LockState.ttl <= now) {
          await Storage.remove(key);
          return null;
        }
        if (Number(record.expiresAt) <= now || !Number.isSafeInteger(record.ticket)
          || record.ticket < 0 || (record.ticket === 0 && record.choosing !== true)) return null;
        return { ...record, key };
      }));
      return records.filter(Boolean);
    },

    async acquire({ force = false } = {}) {
      if (LockState.key || LockState.acquiring) return false;
      LockState.acquiring = true;
      LockState.lost = false;
      this.installPageExitHandler();
      try {
        await this.clearPageExitLock();
        RunGuard.assertActive();
        // 手动运行撤销旧租约，旧任务在下个检查点停止。
        if (force) {
          const previous = await this.records();
          RunGuard.assertActive();
          await Promise.all(previous.map(record => this.revokeLease({
            ...record, expiresAt: Date.now() + LockState.ttl
          })));
          RunGuard.assertActive();
        }
        LockState.id = Date.now() + "-" + Utils.getRandomUUID();
        LockState.key = LockState.prefix + LockState.id;
        await Storage.set(LockState.key, {
          id: LockState.id, choosing: true, ticket: 0, force,
          expiresAt: Date.now() + LockState.ttl, sessionResetId: SessionGuard.resetId
        });
        RunGuard.assertActive();
        const records = await this.records();
        RunGuard.assertActive();
        const own = records.find(record => record.key === LockState.key);
        if (!own || own.expiresAt <= Date.now()) return false;
        const ticket = Math.max(0, ...records.map(record => record.ticket)) + 1;
        await Storage.set(LockState.key, { ...own, choosing: false, ticket, expiresAt: Date.now() + LockState.ttl });

        // 候选选号完成后，按票号和实例 ID 排序。
        for (let attempt = 0; attempt < 20; attempt++) {
          RunGuard.assertActive();
          const active = await this.records();
          RunGuard.assertActive();
          if (!active.some(record => record.key === LockState.key)) return false;
          const others = active.filter(record => record.key !== LockState.key);
          // 手动候选优先；同类候选按票号排序。
          if (!force && others.some(record => record.force === true)) return false;
          const contenders = force ? others.filter(record => record.force === true) : others;
          if (contenders.some(record => record.choosing === true)) {
            await Wait.delay(100);
            continue;
          }
          if (contenders.some(record => record.ticket < ticket
            || record.ticket === ticket && record.id < LockState.id)) return false;
          if (force && others.length > contenders.length) {
            // 清理选号期间新增的自动候选，再复查运行权。
            await Promise.all(others.filter(record => record.force !== true).map(record => this.revokeLease({
              ...record, expiresAt: Date.now() + LockState.ttl
            })));
            continue;
          }
          LockState.held = true;
          this.scheduleHeartbeat();
          return true;
        }
        return false;
      } finally {
        LockState.acquiring = false;
        if (!LockState.held) await this.release();
      }
    },

    scheduleHeartbeat() {
      if (!LockState.held || LockState.lost || LockState.pageLeaving) return;
      LockState.timer = setTimeout(() => {
        LockState.timer = null;
        LockState.renewing = this.renew().catch(() => RunGuard.markLockLost()).finally(() => {
          LockState.renewing = null;
          this.scheduleHeartbeat();
        });
      }, LockState.heartbeatMs);
    },

    async renew() {
      const key = LockState.key;
      const record = await Storage.get(key, null);
      if (!LockState.held || LockState.key !== key) return;
      RunGuard.assertActive();
      await Storage.set(key, { ...record, expiresAt: Date.now() + LockState.ttl });
    },

    // 等待续租结束，仅删除本实例的锁。
    async release() {
      LockState.held = false;
      if (LockState.timer !== null) clearTimeout(LockState.timer);
      LockState.timer = null;
      if (LockState.renewing) await LockState.renewing.catch(() => {});
      const key = LockState.key, id = LockState.id;
      try {
        if (key && (await Storage.get(key, null))?.id === id) await Storage.remove(key);
      } finally {
        LockState.key = LockState.id = "";
        LockState.lost = false;
        LockState.renewing = null;
      }
    }
  };

  // 日志与通知，浏览器和外部渠道分别配置。
  const Notice = {
    // push 启用时按各渠道配置推送。
    log(icon, msg, push = false) {
      if (!Logger.log(icon, msg)) return;
      if (push && Storage.get("Notice.bro", true)) {
        try {
          Platform.notify({
            title: Platform.info.script.name + ` ${icon}`,
            text: msg,
            onclick: () => Platform.openTab("https://rewards.bing.com/dashboard", { active: true })
          });
        } catch(_) {}
      }
      if (push) {
        this.sendWebhook(`${icon} ${msg}`);
      }
    },

    // 非大陆提醒按天去重，回到大陆后重置。
    notifyNonDomesticIp(message = "IP非大陆，已暂停全部任务") {
      const noticeKey = "Config.ipPauseNoticeDate";
      const today = Utils.getTodayNum();
      if (Storage.get(noticeKey, 0) === today) {
        Platform.log("🟡 非大陆 IP 通知今日已发送，跳过重复通知");
        return false;
      }

      Storage.set(noticeKey, today);
      this.log("🔴", message, true);
      return true;
    },

    // 仅发送已配置渠道；单渠道失败不影响其他渠道。
    // 每次发送读取最新配置。
    async sendWebhook(message) {
      await Promise.all(Webhooks.map(async (i) => {
        const safeKey = String(Storage.get(i.storageKey, "") || "").trim();
        if (!safeKey) return;
        const targetUrl = safeKey.startsWith("http") ? safeKey : i.url + safeKey;
        try {
          const result = await HttpClient.text({
            method: "POST",
            url: targetUrl,
            headers: {
              "content-type": "application/json; charset=UTF-8",
            },
            data: JSON.stringify(i.buildMessage(message)),
          });
          if (result) Platform.log(`🔵 「${i.name}」消息推送完成`);
        } catch (e) {
          Platform.log(`🔴 「${i.name}」消息推送出错: ${e.message}`);
        }
      }));
    }
  };

  // App 公共请求头，允许接口按需覆盖。
  const RequestHeaders = {
    app(token, country, overrides = {}) {
      return {
        "content-type": "application/json; charset=UTF-8",
        "user-agent": RewardsAuto.ua.app,
        "authorization": `Bearer ${token}`,
        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
        "x-rewards-ismobile": "true",
        "x-rewards-country": country,
        "x-rewards-language": "zh",
        ...overrides
      };
    }
  };

  // 仅沿允许的微软认证地址和 Rewards 回调完成静默登录。
  const WebAuth = {
    loginUrl(returnUrl) {
      const target = this.authUrl(returnUrl);
      if (target.origin !== "https://rewards.bing.com" ||
        !/^\/(?:earn|dashboard|api\/getuserinfo)\/?$/i.test(target.pathname)) {
        throw new Error("后台认证返回地址无效");
      }
      // earn/dashboard 使用页面登录入口，getuserinfo 经 createuser 返回。
      if (/^\/(?:earn|dashboard)\/?$/i.test(target.pathname)) return target.href;
      return "https://rewards.bing.com/createuser?code=401&userScenarioId=anonsignin&idru=" +
        encodeURIComponent(target.href);
    },

    authUrl(value, base) {
      const url = new URL(value, base);
      if (url.protocol !== "https:" || url.username || url.password || url.port) {
        throw new Error("后台认证地址无效");
      }
      const rewardsRoute = url.hostname === "rewards.bing.com" &&
        /^\/(?:createuser|signin|signin-oidc|auth\/callback|api\/getuserinfo|earn|dashboard)\/?$/i.test(url.pathname);
      const microsoftRoute = url.hostname === "login.live.com" &&
        /^\/(?:oauth20_authorize\.srf|login\.srf)$/i.test(url.pathname)
        || ["login.windows.net", "login.microsoftonline.com"].includes(url.hostname) &&
        /^\/consumers\/oauth2\/v2\.0\/authorize\/?$/i.test(url.pathname);
      if (!rewardsRoute && !microsoftRoute) throw new Error(`后台认证遇到未支持的跳转: ${url.hostname}${url.pathname}`);
      return url;
    },

    decodeAttribute(value) {
      return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, entity) => {
        const key = entity.toLowerCase();
        const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
        if (key[0] !== "#") return named[key];
        const code = key[1] === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      });
    },

    attributes(tag) {
      const attrs = Object.create(null);
      const pattern = /([^\s=<>\/'"]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      for (const match of tag.matchAll(pattern)) {
        const key = match[1].toLowerCase();
        if (!(key in attrs)) attrs[key] = this.decodeAttribute(match[2] ?? match[3] ?? match[4] ?? "");
      }
      return attrs;
    },

    // 仅提交字段完整的唯一隐藏 POST 表单，不执行页面脚本。
    callbackForm(html, responseUrl) {
      const sourceUrl = this.authUrl(responseUrl), origin = sourceUrl.origin;
      if (!["https://login.live.com", "https://login.windows.net", "https://login.microsoftonline.com"].includes(origin)
        || String(html).length > 1024 * 1024) return null;
      const text = String(html).replace(/<!--[\s\S]*?-->|<(script|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
      const forms = [...text.matchAll(/<form\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/form\s*>/gi)];
      if (forms.length !== 1) return null;
      const attrs = this.attributes(forms[0][1]);
      if (String(attrs.method).toLowerCase() !== "post" || !attrs.action ||
        attrs.enctype && attrs.enctype.toLowerCase() !== "application/x-www-form-urlencoded") return null;
      const action = this.authUrl(attrs.action, responseUrl);
      if (!["https://rewards.bing.com/signin-oidc", "https://rewards.bing.com/auth/callback"].includes(action.href)) return null;
      const expectedCallback = sourceUrl.searchParams.get("redirect_uri");
      if (expectedCallback && action.href !== expectedCallback) return null;
      const body = new URLSearchParams();
      for (const match of forms[0][2].matchAll(/<input\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
        const input = this.attributes(match[1]);
        if (String(input.type).toLowerCase() !== "hidden" || !input.name || "disabled" in input ||
          "form" in input || "formaction" in input || body.has(input.name)) return null;
        body.append(input.name, input.value || "");
      }
      if (!body.get("state") || !(body.get("code") || body.get("id_token")) || body.has("error")) return null;
      if (/<(?:button|select|textarea)\b/i.test(forms[0][2])) return null;
      return { method: "POST", url: action.href, data: body.toString(), headers: {
        "content-type": "application/x-www-form-urlencoded",
        "origin": origin, "referer": origin + "/"
      } };
    },

    // 认证跳转受次数和时限约束，保留服务端参数。
    async authenticate(deadline, returnUrl, diagnostics = null) {
      let request = { url: this.loginUrl(returnUrl) }, posted = false, silentRequested = false;
      const isWebPage = /^\/(?:earn|dashboard)\/?$/i.test(new URL(returnUrl).pathname);
      for (let hops = 0; hops < 8 && Date.now() < deadline; hops++) {
        this.authUrl(request.url);
        const response = await HttpClient.recovery({ ...request,
          headers: { "accept": "text/html,application/xhtml+xml",
            ...(isWebPage ? { "cache-control": "no-cache" } : {}), ...request.headers }
        }, deadline - Date.now());
        const responseUrl = new URL(response.finalUrl || request.url);
        if (isWebPage) diagnostics?.push(["🔄", `Rewards 网页认证: HTTP ${response.status} ${responseUrl.hostname}${responseUrl.pathname}`]);
        const finalUrl = this.authUrl(responseUrl);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = String(response.responseHeaders || "").match(/^location:\s*(.+)$/im)?.[1]?.trim();
          if (!location || request.method === "POST" && [307, 308].includes(response.status)) return;
          request = { url: this.authUrl(location, finalUrl).href };
          continue;
        }
        if (response.status < 200 || response.status >= 300) return;
        const form = this.callbackForm(response.responseText, finalUrl.href);
        if (form && !posted) {
          posted = true;
          request = form;
          continue;
        }
        const isAuthorize = finalUrl.origin === "https://login.live.com" &&
          /^\/oauth20_authorize\.srf$/i.test(finalUrl.pathname)
          || ["https://login.windows.net", "https://login.microsoftonline.com"].includes(finalUrl.origin) &&
          /^\/consumers\/oauth2\/v2\.0\/authorize\/?$/i.test(finalUrl.pathname);
        const interactionError = String(response.responseText || "").match(
          /\b(?:login_required|interaction_required|consent_required|account_selection_required)\b/i
        )?.[0];
        if (!posted && !silentRequested && isAuthorize &&
          ["https://rewards.bing.com/signin-oidc", "https://rewards.bing.com/auth/callback"].includes(finalUrl.searchParams.get("redirect_uri")) &&
          finalUrl.searchParams.get("response_mode") === "form_post" && finalUrl.searchParams.has("state") &&
          !interactionError) {
          silentRequested = true;
          finalUrl.searchParams.set("prompt", "none");
          request = { url: finalUrl.href };
          continue;
        }
        if (isWebPage && finalUrl.origin !== "https://rewards.bing.com") {
          diagnostics?.push(["🟡", `Rewards 网页静默认证未完成: ${interactionError || "微软登录页未返回认证回传表单"}`]);
        }
        return;
      }
    },

  };

  // Bing 与 Rewards 分别核验；Rewards 失败可走其他数据源。
  const RewardsWebSession = {
    // 按账号数据和登录标记判断，不以 HTTP 成功代替登录。
    pageLoginState(response) {
      const status = Number(response.status);
      let pageUrl;
      try { pageUrl = new URL(response.finalUrl); } catch (_) { return "unknown"; }
      if (!Number.isInteger(status) || status < 200 || status >= 400 && status !== 401) return "unknown";
      const isLoginUrl = url => url.origin === "https://login.live.com" &&
        /^\/(?:oauth20_authorize\.srf|login\.srf)$/i.test(url.pathname)
        || ["https://login.windows.net", "https://login.microsoftonline.com"].includes(url.origin) &&
        /^\/consumers\/oauth2\/v2\.0\/authorize\/?$/i.test(url.pathname)
        || url.origin === "https://rewards.bing.com" &&
        /^\/(?:createuser|signin|signin-oidc|auth\/callback)\/?$/i.test(url.pathname);
      if (isLoginUrl(pageUrl)) return "signed-out";
      if (pageUrl.origin !== "https://rewards.bing.com") return "unknown";
      if (status === 401) return "signed-out";
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = String(response.responseHeaders || "").match(/^location:\s*(.+)$/im)?.[1]?.trim();
        try { if (location && isLoginUrl(new URL(location, pageUrl))) return "signed-out"; } catch (_) {}
        return "unknown";
      }
      if (status >= 300 || !/^\/(?:earn|dashboard)\/?$/i.test(pageUrl.pathname)) return "unknown";

      let signedIn = false, signedOut = false, accountData = false;
      const isCount = value => Number.isFinite(DataParsers.parseNonNegativeInteger(value, false));
      const hasQuota = value => value && isCount(value.progress) && isCount(value.max) && Number(value.max) > 0;
      const visit = (value, depth = 0) => {
        if (!value || typeof value !== "object" || depth > 64) return;
        if (!Array.isArray(value)) {
          for (const key of ["isAuthenticated", "isSignedIn", "isLoggedIn"]) {
            if (value[key] === true) signedIn = true;
            if (value[key] === false) signedOut = true;
          }
          if (DataParsers.validUserInfo(value) || hasQuota(value.pointsCounters?.pc) || hasQuota(value.combinedSearch)) {
            accountData = true;
          }
        }
        for (const child of Object.values(value)) visit(child, depth + 1);
      };
      const flight = [];
      const html = String(response.responseText || "").replace(/<!--[\s\S]*?-->/g, "");
      for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        const attrs = WebAuth.attributes(script[1]);
        if (attrs.id === "__NEXT_DATA__" && attrs.type === "application/json") {
          try { visit(JSON.parse(script[2])); } catch (_) {}
        }
        flight.push(...DataParsers.flightChunks(script[2]));
      }
      for (const line of flight.join("").split("\n")) {
        const record = line.match(/^[a-f0-9]+:(.*)$/i);
        if (record) { try { visit(JSON.parse(record[1])); } catch (_) {} }
      }
      if (signedIn && signedOut) return "unknown";
      if (signedOut) return "signed-out";
      return signedIn || accountData ? "signed-in" : "unknown";
    },

    // 先读 earn，必要时恢复认证，再读取页面复查。
    async ensure(recoveryTimeout = 45000) {
      const returnUrl = "https://rewards.bing.com/earn";
      const deadline = Date.now() + recoveryTimeout;
      // 失败时集中输出诊断，URL 只记录主机和路径。
      const diagnostics = [];
      const logDiagnostics = () => {
        for (const [icon, message] of diagnostics) Notice.log(icon, message);
      };
      const readPage = async () => {
        const response = await HttpClient.recovery({
          url: returnUrl + "?_rauto_session=" + Date.now(),
          headers: { "accept": "text/html,application/xhtml+xml", "cache-control": "no-cache",
            "user-agent": RewardsAuto.ua.pc, "referer": "https://rewards.bing.com/" }
        }, deadline - Date.now());
        const url = new URL(response.finalUrl || returnUrl);
        diagnostics.push(["🔍", `Rewards 网页响应: HTTP ${response.status} ${url.hostname}${url.pathname}`]);
        return response;
      };
      Notice.log("🔍", "检查 Rewards 网页登录状态...");
      try {
        const response = await readPage();
        const state = this.pageLoginState(response);
        if (state === "signed-in") {
          Notice.log("🟢", "Rewards 网页登录已确认");
          return true;
        }
        if (state !== "signed-out" && !(response.status >= 200 && response.status < 300)) {
          logDiagnostics();
          Notice.log("🟡", "Rewards 网页暂不可用，本轮继续使用原有数据来源");
          return false;
        }
        Notice.log("🟡", state === "signed-out"
          ? "Rewards 网页需要登录，开始恢复"
          : "Rewards 网页状态未确认，尝试后台恢复");
        // 仅做后台认证；开页兜底和冷却由 UserInfoSession 管理。
        await WebAuth.authenticate(deadline, returnUrl, diagnostics);
        if (Date.now() < deadline && this.pageLoginState(await readPage()) === "signed-in") {
          Notice.log("🟢", "Rewards 网页恢复成功，已验证页面账号数据");
          return true;
        }
      } catch (error) {
        if (RunGuard.isStopError(error)) throw error;
        diagnostics.push(["🟡", `Rewards 网页检查/恢复中断: ${String(error.message || "后台请求失败").replace(/^getuserinfo\s+/, "")}`]);
      }
      logDiagnostics();
      Notice.log("🟡", "Rewards 网页尚未确认就绪，本轮继续使用原有数据来源");
      return false;
    },

  };

  // getuserinfo 恢复：合并并发请求；两级恢复都失败后冷却 10 分钟。
  const UserInfoSession = {
    storageKey: "Config.userInfoSessionRecovery.v2",
    recoveryTimeout: 45000, fallbackTimeout: 45000, cooldown: 10 * 60 * 1000,
    pending: null, unavailable: false, attempted: false, warned: false, failureMessage: "",

    // 每轮清理失败和提示标记，在途恢复保持不变。
    beginRun() {
      if (this.pending) return;
      this.unavailable = this.attempted = this.warned = false;
      this.failureMessage = "";
    },

    url() {
      return "https://rewards.bing.com/api/getuserinfo?type=1&X-Requested-With=XMLHttpRequest";
    },

    // 成功须满足目标地址、HTTP 状态及有效用户数据。
    async read(timeout = 15000) {
      const response = await HttpClient.recovery({
        url: this.url() + "&_=" + Date.now(),
        headers: {
          "user-agent": RewardsAuto.ua.pc, "referer": "https://rewards.bing.com/",
          "x-requested-with": "XMLHttpRequest", "cache-control": "no-cache"
        }
      }, timeout);
      if (response.status < 200 || response.status >= 300) {
        throw Object.assign(new Error("getuserinfo HTTP " + response.status), { status: response.status });
      }
      try {
        const finalUrl = new URL(response.finalUrl || this.url());
        const data = JSON.parse(response.responseText);
        if (finalUrl.origin !== "https://rewards.bing.com" ||
          finalUrl.pathname !== "/api/getuserinfo" || !DataParsers.validUserInfo(data)) throw new Error("invalid data");
        return data;
      } catch (_) {
        if (RunGuard.isStopError(_)) throw _;
        throw new Error("getuserinfo 未返回有效用户数据");
      }
    },

    async recoverWithoutTab() {
      const deadline = Date.now() + this.recoveryTimeout;
      try { await WebAuth.authenticate(deadline, this.url(), null); } catch (_) { if (RunGuard.isStopError(_)) throw _; }
      for (let checks = 0; checks < 2 && Date.now() < deadline; checks++) {
        if (checks) await Wait.delay(Math.min(1000, deadline - Date.now()));
        if (Date.now() >= deadline) break;
        try { return await this.read(deadline - Date.now()); }
        catch (error) {
          if (RunGuard.isStopError(error)) throw error;
          if (error.status === 401 || error.status === 403 || error.status === 429) break;
        }
      }
      return null;
    },

    closeTab(tab) {
      try {
        const closing = tab?.close?.();
        if (closing && typeof closing.catch === "function") closing.catch(() => {});
      } catch (_) {}
    },

    // 开页最多等 5 秒；超时或会话停止后关闭迟到页面。
    async openFallbackTab() {
      await WebSession.ensure();
      let timer, expired = false;
      const opening = Promise.resolve(Platform.openTab(WebAuth.loginUrl(this.url()), {
        active: false, insert: true, setParent: true
      })).then(tab => {
        if (expired || SessionGuard.isStopped()) this.closeTab(tab);
        RunGuard.assertActive();
        return tab;
      });
      try {
        return await Promise.race([
          opening,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              expired = true;
              reject(new Error("无法及时打开网页登录页"));
            }, 5000);
          })
        ]);
      } finally { clearTimeout(timer); }
    },

    // 开兜底页后轮询用户信息，结束时始终尝试关页。
    async recoverWithTab() {
      let tab = null;
      const deadline = Date.now() + this.fallbackTimeout;
      try {
        tab = await this.openFallbackTab();
        for (let checks = 0; checks < 12 && Date.now() < deadline; checks++) {
          if (tab?.closed === true) break;
          await Wait.delay(Math.min(3000, deadline - Date.now()));
          if (Date.now() >= deadline) break;
          try { return await this.read(deadline - Date.now()); }
          catch (error) {
            if (RunGuard.isStopError(error)) throw error;
            if (error.status === 403 || error.status === 429) break;
          }
        }
      } catch (_) {
        if (RunGuard.isStopError(_)) throw _;
      } finally { this.closeTab(tab); }
      return null;
    },

    warn(message, quiet) {
      this.failureMessage = message;
      if (quiet || this.warned) return;
      this.warned = true;
      Notice.log("🟡", message);
    },

    // 本轮不可用时返回 null；并发调用共用 pending。
    async get({ quiet = false } = {}) {
      await WebSession.ensure();
      if (this.unavailable) {
        if (this.failureMessage) this.warn(this.failureMessage, quiet);
        return null;
      }
      if (this.pending) return this.pending;
      this.pending = this.load(quiet);
      try { return await this.pending; }
      finally { this.pending = null; }
    },

    // 仅 401 触发恢复；其他错误暂停本轮数据源。
    async load(quiet) {
      try {
        return await this.read();
      } catch (error) {
        if (RunGuard.isStopError(error)) throw error;
        if (error.status !== 401) {
          this.unavailable = true;
          this.warn(error.message + "，本轮继续使用其他数据来源", quiet);
          return null;
        }
      }
      if (this.attempted) {
        this.unavailable = true;
        this.warn("getuserinfo 会话仍未就绪，本轮不再重复登录，继续使用其他数据来源", quiet);
        return null;
      }
      this.attempted = true;
      let data = null;
      try { data = await this.recover(quiet); } catch (_) { if (RunGuard.isStopError(_)) throw _; }
      if (!data) {
        this.unavailable = true;
        this.warn(this.failureMessage || "getuserinfo 两次恢复均未完成，本轮继续使用其他数据来源", quiet);
      }
      return data;
    },

    // 等待其他实例恢复，再读接口验证。
    async waitForOther(record) {
      const deadline = Math.min(record.expiresAt, Date.now() + this.recoveryTimeout + this.fallbackTimeout + 5000);
      while (Date.now() < deadline) {
        const latest = await Storage.get(this.storageKey, null);
        if (!latest || latest.id !== record.id) break;
        if (latest.state === "ready") {
          try { return await this.read(deadline - Date.now()); } catch (_) {
            if (RunGuard.isStopError(_)) throw _;
            break;
          }
        }
        if (latest.state !== "running") break;
        await Wait.delay(Math.min(500, deadline - Date.now()));
      }
      return null;
    },

    // 共享 running/ready/failed 状态；写入后复查归属。
    async recover(quiet) {
      const now = Date.now(), previous = await Storage.get(this.storageKey, null);
      if (previous?.state === "running" && previous.expiresAt > now) return this.waitForOther(previous);
      if (previous?.nextAttemptAt > now) {
        this.warn("getuserinfo 自动恢复处于 10 分钟冷却期，本轮继续使用其他数据来源", quiet);
        return null;
      }
      const id = now + "-" + Math.random().toString(36).slice(2);
      await Storage.set(this.storageKey, {
        id, state: "running", expiresAt: now + this.recoveryTimeout + this.fallbackTimeout + 5000,
        nextAttemptAt: 0
      });
      let data = null, method = "";
      try {
        await Wait.delay(150 + Math.floor(Math.random() * 150));
        const owner = await Storage.get(this.storageKey, null);
        if (owner?.id !== id) return owner ? this.waitForOther(owner) : null;
        // 先后台请求恢复，失败后用一个后台标签页兜底。
        if (!quiet) Notice.log("🟡", "getuserinfo 开始恢复（最多 45 秒）");
        try { data = await this.recoverWithoutTab(); } catch (_) { if (RunGuard.isStopError(_)) throw _; }
        if (data) method = "xhr";
        if (!data) {
          if (!quiet) Notice.log("🟡", "getuserinfo 恢复未成功，启用后台标签页兜底（最多 45 秒）");
          data = await this.recoverWithTab();
          if (data) method = "tab";
        }
      } catch (_) {
        if (RunGuard.isStopError(_)) throw _;
      } finally {
        try {
          // 仅更新本次记录；跨日直接删除，避免误记失败冷却。
          const latest = await Storage.get(this.storageKey, null);
          if (latest?.id === id && RunDateGuard.hasChanged()) await Storage.remove(this.storageKey);
          else if (!LockState.lost && latest?.id === id) await Storage.set(this.storageKey, {
            id, state: data ? "ready" : "failed", expiresAt: Date.now(),
            nextAttemptAt: data ? 0 : Date.now() + this.cooldown, method
          });
        } catch (_) { if (RunGuard.isStopError(_)) throw _; }
      }
      if (data && !quiet) Notice.log("🟢", method === "xhr"
        ? "getuserinfo 恢复成功，已验证有效用户数据"
        : "getuserinfo 后台标签页兜底成功，已验证有效用户数据并关闭登录页");
      return data;
    }
  };

  // App 授权：管理凭据，遇 401 时重试一次请求。
  const AppTokenSession = {
    async getToken(url, maxRetries = 3) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const res = await HttpClient.text({ url });
          if (!Utils.isJSON(res)) {
            if (attempt < maxRetries) {
              await Wait.delay(3210);
              continue;
            }
            return false;
          }
          const data = JSON.parse(res);
          if (data.error) {
            Notice.log("🔴", `Token错误: ${data.error} - ${data.error_description || ''}`);
            if (["invalid_grant","invalid_request"].includes(data.error)) {
              Storage.set("Config.token", false);
              Storage.set("Config.code", "");
            }
            return false;
          }
          // 两种凭据齐全才保存；仅 refresh token 持久化。
          if (data.refresh_token && data.access_token) {
            Storage.set("Config.token", data.refresh_token);
            Storage.set("Config.tokenTime", Date.now());
            RunState.token = data.access_token;
            return true;
          }
          if (attempt < maxRetries) {
            await Wait.delay(3210);
            continue;
          }
          return false;
        } catch (e) {
          if (RunGuard.isStopError(e)) throw e;
          if (e.message.includes("400") || e.message.includes("401")) {
            Storage.set("Config.token", false);
            Storage.set("Config.code", "");
            return false;
          }
          if (attempt < maxRetries) {
            await Wait.delay(3210);
            continue;
          }
          Notice.log("🔴", `Token请求失败: ${e.message}`);
          return false;
        }
      }
      return false;
    },

    // 无 token 返回 null；401 重新授权成功后重放一次。
    async withTokenRetry(requestFn) {
      RunGuard.assertActive();
      let token = RunState.token;
      if (!token) return null;
      try {
        return await requestFn(token);
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        if (e.message && e.message.includes("401")) {
          Notice.log("🟡", "Token 过期，强制重新授权...");
          RunState.token = null;
          Storage.set("Config.token", false);
          Storage.set("Config.tokenTime", 0);
          const refreshed = await this.renewToken();
          if (!refreshed) return null;
          return await requestFn(RunState.token);
        }
        throw e;
      }
    },

    async renewToken() {
      await WebSession.ensure();
      if (!Storage.get("Tasks.sign", true) && !Storage.get("Tasks.read", true)) return true;

      let refreshToken = Storage.get("Config.token", false);
      const tokenTime = Storage.get("Config.tokenTime", 0);

      // 刷新凭据超过 7 天时，改取新授权码。
      if (tokenTime > 0) {
        const days = (Date.now() - tokenTime) / (1000 * 60 * 60 * 24);
        if (days > 7) {
          Notice.log("🟡", `Token已${Math.floor(days)}天，提前续期`);
          refreshToken = false;
        }
      }

      const authUrl = "https://login.live.com/oauth20_authorize.srf?client_id=0000000040170455&response_type=code&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL&redirect_uri=https://login.live.com/oauth20_desktop.srf";

      // 优先自动取 code，失败后开页等待手动授权。
      const fetchCode = async (msg) => {
        Storage.set("Config.code", "");
        Notice.log("🟡", `${msg}，尝试自动获取授权码...`);

        try {
          const res = await HttpClient.text({
            method: "GET", url: authUrl, fullResponse: true,
            headers: { "User-Agent": Platform.navigator.userAgent }
          });
          const finalUrl = res.finalUrl || "";
          const code = new URL(finalUrl).searchParams.get("code");
          if (code) {
            Notice.log("🟢", "自动获取授权码成功");
            return [code];
          }
        } catch (e) {
          if (RunGuard.isStopError(e)) throw e;
          Notice.log("🟡", `自动获取失败: ${e.message}`);
        }

        await WebSession.ensure();
        Notice.log("🟡", "请手动完成授权...");
        Platform.openTab(authUrl, { active: true, insert: true, setParent: true });

        if (Storage.get("Notice.bro", true)) {
          try {
            Platform.notify({
              text: "完成后粘贴地址栏URL到脚本设置的「授权码链接」",
              title: "🟡 需要授权", timeout: 0
            });
          } catch(_) {}
        }

        // 每秒读取授权码，支持回调 URL 或 code，最多等 3 分钟。
        for (let i = 0; i < 180; i++) {
          await Wait.delay(1000);
          const raw = Storage.get("Config.code", "");
          if (!raw) continue;

          let code = null;
          if (raw.includes("code=")) {
            try {
              const url = new URL(raw);
              code = url.searchParams.get("code");
            } catch {}
          }
          if (!code && raw.length > 20 && !raw.includes("http")) {
            code = raw.trim();
          }

          if (code && code.length > 10) {
            Notice.log("🟢", "授权码获取成功");
            return [code];
          }
        }
        Notice.log("🔴", "授权码获取超时", true);
        return false;
      };

      // 先刷新凭据；失败后最多取两次新 code，旧 code 不重用。
      RunState.token = false;
      if (refreshToken) {
        const url = "https://login.live.com/oauth20_token.srf?client_id=0000000040170455&refresh_token=" +
          encodeURIComponent(refreshToken) + "&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL&grant_type=REFRESH_TOKEN";
        if (await this.getToken(url)) return true;
      }

      const maxAuthAttempts = 2;
      for (let attempt = 0; attempt < maxAuthAttempts; attempt++) {
        const message = attempt > 0 ? "授权码失效" : refreshToken ? "Token失效" : "检测到授权码为空";
        const codeMatch = await fetchCode(message);
        if (!codeMatch) return false;
        const url = "https://login.live.com/oauth20_token.srf?client_id=0000000040170455&code=" +
          encodeURIComponent(codeMatch[0]) + "&redirect_uri=https://login.live.com/oauth20_desktop.srf&grant_type=authorization_code";
        if (await this.getToken(url)) {
          Notice.log("🟢", "Token获取成功！", true);
          return true;
        }
      }
      Notice.log("🔴", "Token 获取失败，已达到本轮授权尝试上限，不再重复授权");
      return false;
    },

  };

  // 阅读进度与上报服务，支持服务器下发的 offerId。
  const ReadingService = {
    _readOfferId: "", _readOfferLogDate: 0,

    async getReadProgress() {
      const region = Utils.isRegionLockEnabled() ? "cn" : RunState.region.toLowerCase();
      try {
        const res = await AppTokenSession.withTokenRetry(token => HttpClient.text({
          url: "https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613",
          headers: RequestHeaders.app(token, region)
        }));
        if (Utils.isJSON(res)) {
          const payload = JSON.parse(res);
          const promos = Array.isArray(payload.response?.promotions) ? payload.response.promotions : [];
          const configuredOfferId = String(RewardsAuto.appConfig.offerIds.readArticle || "").trim();
          const getAttributes = item => item?.attributes && typeof item.attributes === "object"
            ? item.attributes : item || {};
          const getOfferId = item => String(getAttributes(item).offerid || getAttributes(item).offerId || "").trim();
          const parseCounter = value => DataParsers.parseNonNegativeInteger(value);
          const configuredLower = configuredOfferId.toLowerCase();
          const task = promos.find(item => getOfferId(item).toLowerCase() === configuredLower)
            || promos
              .map(item => ({ item, id: getOfferId(item), attrs: getAttributes(item) }))
              .filter(({ id, attrs }) => id && /(read|article|阅读)/i.test(`${id} ${attrs.title || attrs.name || ""}`))
              .sort((a, b) => {
                const aMax = parseCounter(a.attrs.max);
                const bMax = parseCounter(b.attrs.max);
                return (Number.isFinite(bMax) ? bMax : 0) - (Number.isFinite(aMax) ? aMax : 0);
              })[0]?.item;
          if (task) {
            const attrs = getAttributes(task);
            const readOfferId = getOfferId(task);
            const progress = parseCounter(attrs.progress);
            const max = parseCounter(attrs.max);
            if (!Number.isFinite(progress) || !Number.isFinite(max) || max <= 0) {
              Notice.log("🟡", "阅读进度字段无效，无法确认完成状态");
              return false;
            }
            ReadingState.progress = progress;
            ReadingState.max = max;
            this._readOfferId = readOfferId || configuredOfferId;
            if (this._readOfferId.toLowerCase() !== configuredLower && this._readOfferLogDate !== RunState.dateNowNum) {
              this._readOfferLogDate = RunState.dateNowNum;
              Notice.log("🟡", `阅读任务使用动态 offerId: ${this._readOfferId}（配置值 ${configuredOfferId} 已不匹配）`);
            }
            Notice.log("📊", `阅读进度查询: ${progress}/${max} (offerid: ${readOfferId})`);
            return { progress, max };
          }
          const ids = promos.map(getOfferId).filter(Boolean).slice(0, 20);
          Notice.log("🟡", `阅读任务未找到 (配置 offerid: ${configuredOfferId})${ids.length ? `；DAPI offerid: ${ids.join(", ")}` : "；DAPI 未返回 promotions"}`);
        } else {
          Notice.log("🟡", `DAPI 响应不是 JSON: ${String(res).substring(0, 100)}`);
        }
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        Notice.log("🔴", `阅读进度获取失败: ${e.message}`);
      }
      return false;
    },

    // 单次上报成功后，仍需查进度确认当天完成。
    async doRead() {
      const region = Utils.isRegionLockEnabled() ? "cn" : RunState.region.toLowerCase();
      try {
        const offerId = this._readOfferId || RewardsAuto.appConfig.offerIds.readArticle;
        // 拼接两个 UUID，生成 56 位十六进制活动 ID。
        const id = Utils.getRandomUUID() + Utils.getRandomUUID().slice(0, 24);
        const res = await AppTokenSession.withTokenRetry(token => HttpClient.text({
          method: "POST",
          url: "https://prod.rewardsplatform.microsoft.com/dapi/me/activities",
          headers: RequestHeaders.app(token, region, { "content-type": "application/json; charset=utf-8" }),
          data: JSON.stringify({
            amount: 1, country: region, id: id,
            type: 101, attributes: { offerid: offerId }
          })
        }));
        if (Utils.isJSON(res)) {
          const data = JSON.parse(res);
          if (data.error || data.success === false || data.response?.success === false) {
            Notice.log("🟡", `阅读接口拒绝上报 (${offerId}): ${String(data.error || data.response?.message || "success=false").slice(0, 160)}`);
            return null;
          }
          if (!data.response?.activity && !data.response?.isDuplicate) {
            Notice.log("🟡", `阅读接口响应未确认成功 (${offerId}): ${String(res).slice(0, 240)}`);
            return null;
          }
          const points = data.response?.activity?.p || 0;
          const isDuplicate = data.response?.isDuplicate || false;
          return { points, isDuplicate };
        }
        return null;
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        Notice.log("🔴", `阅读请求失败: ${e.message}`);
        return false;
      }
    }
  };

  /**
   * 统一卡片字段，保留原始属性。
   * @typedef {Object} RewardCard
   * @property {string} offerId 活动编号与去重依据。
   * @property {string} title 日志标题。
   * @property {string} kind 按编号和标题推断的类别。
   * @property {string} source 数据来源。
   * @property {boolean|null} isCompleted true 完成，false 未完成，null 未知。
   * @property {string} hash 当前会话的活动校验值。
   * @property {number} points 卡片显示积分。
   * @property {boolean|null} isPromotional 促销标记，未知为 null。
   * @property {number} type 活动类型，默认 11。
   * @property {string} pageUrl Rewards 来源页。
   * @property {string} destinationUrl 跳转地址，不用于获取验证令牌。
   */
  // 卡片识别、Action 发现、提交及完成复查。
  const CardService = {
    _cardActionKey: undefined, _cardActionId: undefined, _cardActionAsset: undefined,

    // 优先用锁定字段，再查 offerId；notsupported 不代表锁定。
    cardLockReason(card) {
      const locked = DataParsers.booleanFlag(card.isLocked ?? card.locked);
      const unlocked = DataParsers.booleanFlag(card.isUnlocked);
      const state = String(card.state ?? card.status ?? "").toLowerCase();
      const exclusiveState = String(card.exclusiveLockedFeatureStatus || "").toLowerCase();
      if (locked === true || unlocked === false || /^(locked|unavailable|disabled)$/.test(state)
        || exclusiveState === "locked") {
        return "服务器标记为锁定或暂不可用";
      }
      if (locked === false || unlocked === true || exclusiveState === "unlocked"
        || /^(unlocked|available|active)$/.test(state)) return "";
      if (/(?:^|[_-])locked(?:[_-]|$)/i.test(String(card.offerId || ""))) {
        return "服务器标记为锁定或暂不可用";
      }
      return "";
    },

    // 按忽略大小写的 offerId 去重。
    cardKey(card) {
      return String(card.offerId || "").trim().toLowerCase();
    },

    /**
     * 统一卡片字段；无活动编号返回 null。
     * @param {Object|null} item 原始卡片。
     * @param {string} source 数据来源。
     * @returns {RewardCard|null}
     */
    normalizeCard(item, source) {
      if (!item || typeof item !== "object") return null;
      const offerId = String(item.offerId || item.offerid || item.offer_id || item.id || item.name || "").trim();
      if (!offerId) return null;
      const done = [item.isCompleted, item.complete, item.completed]
        .map(value => DataParsers.booleanFlag(value)).find(v => v !== null);
      const max = Number(item.pointProgressMax || 0), progress = Number(item.pointProgress);
      const state = String(item.state || item.status || "").toLowerCase();
      // 按完成标记、状态和进度判断，未知为 null。
      const isCompleted = done === true || /^(completed|claimed)$/.test(state) || (max > 0 && progress >= max)
        ? true : done === false || (max > 0 && Number.isFinite(progress)) ? false : null;
      const title = String(item.title || item.name || item.description || "");
      const text = `${offerId} ${title}`;
      // 类别仅用于开关和日志，上报流程共用。
      const kind = /quiz|trivia/i.test(text) ? "quiz" : /puzzle/i.test(text) ? "puzzle"
        : /image/i.test(text) ? "image_creator" : /explore|search/i.test(text) ? "explore_search"
        : /dailyset|daily/i.test(text) ? "daily" : /streak/i.test(text) ? "streak" : "open_only";
      let destinationUrl = "";
      try {
        const target = new URL(item.destinationUrl || item.destination || item.url || "", "https://rewards.bing.com/earn");
        if ((item.destinationUrl || item.destination || item.url) && target.protocol === "https:") destinationUrl = target.href;
      } catch (_) {}
      return {
        ...item, offerId, title, kind, source, isCompleted,
        hash: String(item.hash || item.activityId || ""),
        points: Number(item.points ?? item.pointProgressMax ?? item.max ?? 0),
        isPromotional: DataParsers.booleanFlag(item.isPromotional),
        type: Number.isInteger(item.type) ? item.type : 11,
        pageUrl: "https://rewards.bing.com/earn", destinationUrl
      };
    },

    // 优先读取 Flight 卡片，旧页面属性作补充。
    pageCardData(html) {
      let text = String(html || "");
      const flight = DataParsers.flightChunks(text);
      if (flight.length) {
        text = flight.join("");
      }
      const cards = [];
      let recognized = false;
      const names = /"(activityCards|promotionCards|promotions|dailySet|dailySetItems|cards)"\s*:\s*\[/g;
      for (const match of text.matchAll(names)) {
        const start = match.index + match[0].length - 1;
        let depth = 0, quoted = false, escaped = false;
        for (let i = start; i < text.length; i++) {
          const ch = text[i];
          if (quoted) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') quoted = false;
          } else if (ch === '"') quoted = true;
          else if (ch === "[") depth++;
          else if (ch === "]" && --depth === 0) {
            try {
              const items = JSON.parse(text.slice(start, i + 1));
              const activityItems = items.filter(item => item && (item.offerId || item.offerid || item.offer_id));
              if (activityItems.length || /^(activityCards|promotionCards|promotions)$/.test(match[1])) {
                recognized = true;
                cards.push(...items);
              }
            } catch (_) {}
            break;
          }
        }
      }
      // 旧属性只补活动标识，完成状态仍为未知。
      if (!recognized) {
        for (const m of text.matchAll(/data-offer-id="([^"]+)"[^>]*data-hash="([^"]+)"/gi)) {
          cards.push({ offerId: m[1], hash: m[2], points: 1 });
        }
        recognized = cards.length > 0;
      }
      return { cards, recognized };
    },

    extractCardAction(source) {
      // 按参数边界匹配 reportActivity，避免误取其他 Action。
      const text = String(source || ""), ids = new Set();
      const calls = /\bcreateServerReference(?:\s*["']\s*\])?\s*\)?\s*\(/g;
      for (const match of text.matchAll(calls)) {
        const start = match.index + match[0].length;
        const args = [];
        let depth = 0, quote = "", escaped = false, argumentStart = start, closed = false;
        for (let i = start; i < Math.min(text.length, start + 8192); i++) {
          const ch = text[i];
          if (quote) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === quote) quote = "";
            continue;
          }
          if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
          if (ch === "/" && text[i + 1] === "*") {
            const end = text.indexOf("*/", i + 2);
            if (end < 0) break;
            i = end + 1;
            continue;
          }
          if (ch === "/" && text[i + 1] === "/") {
            const end = text.indexOf("\n", i + 2);
            if (end < 0) break;
            i = end;
            continue;
          }
          if (ch === ")" && depth === 0) {
            const last = text.slice(argumentStart, i).trim();
            if (last) args.push(last);
            closed = true;
            break;
          }
          if (ch === "," && depth === 0) {
            args.push(text.slice(argumentStart, i).trim());
            argumentStart = i + 1;
          } else if ("([{".includes(ch)) depth++;
          else if (")]}".includes(ch)) { if (--depth < 0) break; }
          else if (ch === ";" && depth === 0) break;
        }
        const id = args[0]?.match(/^["']([a-f0-9]{40,})["']$/i);
        if (closed && args.length === 5 && id && /^["']reportActivity["']$/.test(args[4])) ids.add(id[1]);
      }
      return ids.size === 1 ? [...ids][0] : "";
    },

    cardActionText(source) {
      return String(source || "").replace(/\\(?:\/|u002f)/gi, "/")
        .replace(/\\u0026|&amp;/gi, "&").replace(/\\"|&quot;/g, '"');
    },

    cardActionChunks(source, baseUrl = "https://rewards.bing.com/earn") {
      const urls = new Set(), base = new URL(baseUrl);
      // 只收集官网 chunks 及其脚本依赖。
      for (const match of this.cardActionText(source).matchAll(/["']([^"'<>\\\s]+\.js(?:\?[^"'<>\\\s]*)?)["']/g)) {
        try {
          let path = match[1];
          if (/^\/?static\/chunks\//.test(path)) path = "/_next/" + path.replace(/^\//, "");
          else if (path.startsWith("_next/")) path = "/" + path;
          const url = new URL(path, base);
          if (url.origin !== "https://rewards.bing.com" || url.username || url.password
            || !url.pathname.startsWith("/_next/static/chunks/") || !url.pathname.endsWith(".js")) continue;
          if (!url.searchParams.has("dpl") && base.searchParams.has("dpl")) {
            url.searchParams.set("dpl", base.searchParams.get("dpl"));
          }
          url.hash = "";
          urls.add(url.href);
        } catch (_) {}
      }
      return [...urls];
    },

    // 每轮清 Action 缓存，保留上次命中的 JS 地址。
    beginCardRun() {
      this._cardActionKey = null;
      this._cardActionId = "";
    },

    async resolveCardAction(html) {
      RunGuard.assertActive();
      const clean = this.cardActionText(html), inlineId = this.extractCardAction(clean);
      const urls = this.cardActionChunks(clean);
      const key = [inlineId, ...urls.slice().sort()].join("\n");
      // 缓存仅限本轮同组资源，换包后重新识别。
      if (this._cardActionKey === key && this._cardActionId) return this._cardActionId;
      this._cardActionKey = null;
      this._cardActionId = "";
      const remember = (id, asset) => {
        RunGuard.assertActive();
        this._cardActionKey = key;
        this._cardActionId = id;
        this._cardActionAsset = asset;
        Notice.log("🟢", `动态 reportActivity: ${id}（来源：${asset || "活动页面"}）`);
        return id;
      };
      if (inlineId) return remember(inlineId, "");

      // 每批 4 个，最多 128 个 JS；45 秒后不再开新批次。
      urls.sort((a, b) => Number(b === this._cardActionAsset) - Number(a === this._cardActionAsset));
      const seen = new Set(urls), startedAt = Date.now();
      const maxFiles = 128, maxTime = 45000;
      let checked = 0, failed = 0, firstError = "";
      while (checked < urls.length && checked < maxFiles && Date.now() - startedAt < maxTime) {
        const batch = await Promise.all(urls.slice(checked, Math.min(checked + 4, maxFiles)).map(async url => {
          try {
            const source = await HttpClient.text({ url, headers: { "cache-control": "no-cache" } });
            return { url, source, id: this.extractCardAction(source) };
          } catch (e) {
            if (RunGuard.isStopError(e)) throw e;
            return { url, source: "", id: "", error: String(e.message || e) };
          }
        }));
        checked += batch.length;
        for (const result of batch) {
          if (!result.error) continue;
          failed++;
          if (!firstError) firstError = `${new URL(result.url).pathname.split("/").pop()}: ${result.error.slice(0, 120)}`;
        }
        const found = batch.find(result => result.id);
        if (found) return remember(found.id, found.url);
        for (const result of batch) {
          for (const url of this.cardActionChunks(result.source, result.url)) {
            if (seen.has(url)) continue;
            seen.add(url);
            urls.push(url);
          }
        }
      }
      const detail = urls.length ? `发现 ${urls.length} 个 JS，已检查 ${checked} 个，请求失败 ${failed} 个`
        : "页面未提供可识别的官网 JS 依赖";
      const limit = checked < urls.length ? "；已达到本轮扫描上限" : "";
      Notice.log("🟡", `未识别到官网 reportActivity ID：${detail}${limit}${firstError ? `；${firstError}` : ""}；保留活动未完成，下次扫描重新识别`);
      return "";
    },

    cardActionResult(response) {
      const inspect = value => {
        if (typeof value === "boolean") return value;
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        if (value.error || value.success === false || value.ok === false) return false;
        return value.success === true || value.ok === true ? true : null;
      };
      try {
        const direct = inspect(typeof response === "string" ? JSON.parse(response) : response);
        if (direct !== null) return direct;
      } catch (_) {}
      // 只取 RSC 根记录引用的 Action 结果，忽略其他成功字段。
      const records = new Map();
      for (const line of String(response || "").split(/\r?\n/)) {
        const m = line.match(/^([a-f0-9]+):(.*)$/i);
        if (!m) continue;
        try { records.set(m[1], m[2].startsWith("E{") ? { error: true } : JSON.parse(m[2])); } catch (_) {}
      }
      let value = records.get("0")?.a;
      for (let depth = 0; depth < 6; depth++) {
        const ref = typeof value === "string" && value.match(/^\$@?([a-f0-9]+)$/i);
        if (!ref) return inspect(value);
        value = records.get(ref[1]);
      }
      return null;
    },

    // 返回扫描快照：识别状态、待处理卡片、全部状态及 Action 就绪标记。
    async discoverCards({ quiet = false, resolveAction = true } = {}) {
      const states = new Map();
      let html = "", pageOk = false, userInfoOk = false;
      const merge = (item, source) => {
        const card = this.normalizeCard(item, source);
        if (!card) return;
        const key = this.cardKey(card), previous = states.get(key);
        if (!previous || source === "page") states.set(key, card);
      };
      try {
        const data = await UserInfoSession.get({ quiet });
        if (data) {
          const dashboard = data.dashboard || data;
          const daily = dashboard.dailySetPromotions;
          const more = dashboard.morePromotions || dashboard.promotions;
          userInfoOk = Array.isArray(more) || (!!daily && typeof daily === "object" && !Array.isArray(daily));
          const now = new Date();
          const dates = new Set([`${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`,
            `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${now.getFullYear()}`]);
          for (const date of dates) {
            if (Array.isArray(daily?.[date])) for (const item of daily[date]) merge(item, "getuserinfo");
          }
          if (Array.isArray(more)) for (const item of more) merge(item, "getuserinfo");
        }
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        if (!quiet) Notice.log("🟡", `getuserinfo 活动解析跳过: ${e.message}`);
      }
      // 先恢复 getuserinfo 会话，再读 earn，避免使用旧 hash。
      try {
        html = await HttpClient.text({ url: "https://rewards.bing.com/earn", headers: { "cache-control": "no-cache" } });
        const page = this.pageCardData(html);
        pageOk = page.recognized;
        for (const item of page.cards) merge(item, "page");
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        if (!quiet) Notice.log("🟡", `活动页面获取失败: ${e.message}`);
      }
      const cards = [];
      for (const card of states.values()) {
        const lockReason = this.cardLockReason(card);
        if (lockReason) {
          if (!quiet) Notice.log("🔒", `跳过卡片(${card.offerId}): ${lockReason}`);
          continue;
        }
        if (card.isCompleted === true || !Number.isFinite(card.points) || card.points <= 0) continue;
        if (RewardsAuto.skipPatterns.some(pattern => `${card.offerId} ${card.title}`.toLowerCase().includes(pattern.toLowerCase()))) continue;
        cards.push(card);
      }
      // 明确空列表算识别成功；两个来源都无法识别才失败。
      const ok = pageOk || userInfoOk;
      if (!ok && !quiet) Notice.log("🟡", "未取得可识别的活动数据，不能判断活动是否完成");
      if (cards.length && resolveAction) await this.resolveCardAction(html);
      return { ok, states, cards, actionReady: Boolean(this._cardActionId) };
    },

    /**
     * 提交后复查服务器完成状态。
     * @param {RewardCard} card 待提交卡片。
     * @param {boolean} [allowHashRetry=true] 明确失败且 hash 更新时允许补试一次。
     * @returns {Promise<boolean|null>} true 已完成，false 未确认，null 跳过锁定项。
     */
    async claimCard(card, allowHashRetry = true) {
      const lockReason = this.cardLockReason(card);
      if (lockReason) {
        Notice.log("🔒", `跳过卡片(${card.offerId}): ${lockReason}`);
        return null;
      }
      if (card.isCompleted === true) return true;
      if (!card.offerId || !card.hash) {
        Notice.log("🟡", `卡片领取失败(${card.offerId || "未知活动"}): 缺少活动编号或 hash`);
        return false;
      }
      const nextAction = this._cardActionId;
      if (!nextAction) {
        Notice.log("🟡", `卡片未提交(${card.offerId}): 当前官网 reportActivity ID 未确认`);
        return false;
      }
      let result = null, error = "";
      try {
        const response = await HttpClient.text({
          method: "POST", url: "https://rewards.bing.com/earn",
          headers: {
            "accept": "text/x-component", "content-type": "text/plain;charset=UTF-8",
            "next-action": nextAction, "referer": "https://rewards.bing.com/earn", "origin": "https://rewards.bing.com"
          },
          data: JSON.stringify([card.hash, card.type ?? 11, {
            offerid: card.offerId,
            isPromotional: card.isPromotional == null || card.isPromotional === "$undefined" ? "$undefined" : String(card.isPromotional),
            timezoneOffset: new Date().getTimezoneOffset().toString()
          }]),
          anonymous: false
        });
        result = this.cardActionResult(response);
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        error = e.message;
      }
      // 响应未知或请求报错也复查服务器，已完成则确认。
      await Wait.delay(1000);
      const scan = await this.discoverCards({ quiet: true, resolveAction: false });
      const completed = scan?.ok ? scan.states.get(this.cardKey(card))?.isCompleted : null;
      if (completed === true) {
        Notice.log("✅", `活动已由服务器确认完成: ${card.title || card.offerId}`);
        return true;
      }
      const refreshed = scan?.ok ? scan.states.get(this.cardKey(card)) : null;
      // 仅明确失败、仍未完成且 hash 更新时补试一次。
      if (allowHashRetry && result === false && completed === false
        && refreshed && !this.cardLockReason(refreshed)
        && this.cardKey(refreshed) === this.cardKey(card)
        && refreshed.hash && refreshed.hash !== card.hash) {
        Notice.log("🔄", `卡片上报未成功且 hash 已刷新，补试一次(${card.offerId})`);
        return this.claimCard(refreshed, false);
      }
      const reason = error || (result === false ? "Server Action 返回未成功" : result === true ? "上报已接受" : "上报响应未确认");
      Notice.log("🟡", `卡片未确认(${card.offerId}): ${reason}；${completed === false ? "服务器仍显示未完成" : "无法确认服务器完成状态"}`);
      return false;
    }
  };

  // 组合页面、getuserinfo 和 App 数据，查询配额与汇总。
  const RewardsQuery = {
    async getRewardsPage(maxRetries = 3) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const html = await HttpClient.text({ url: "https://rewards.bing.com/earn" });
          if (typeof html !== "string") throw new Error("earn 页面无效");
          return RewardsPage.prepare(html);
        } catch (e) {
          if (RunGuard.isStopError(e)) throw e;
          if (attempt < maxRetries) {
            await Wait.delay(3210);
            continue;
          }
          Notice.log("🔴", `仪表盘获取失败: ${e.message}`);
        }
      }
      return null;
    },

    // 同次查询复用来源数据，下次核验重新请求。
    async getSearchSnapshot(maxRetries = 3) {
      const page = await this.getRewardsPage(maxRetries);
      // earn 请求失败直接返回；仅页面无配额时用接口兜底。
      if (!page) return { page: null, quota: SearchQuota.create("failed", "page"), data: null };
      const pageQuota = RewardsPage.searchQuota(page);
      if (pageQuota.source === "page-table" && pageQuota.pc) {
        Notice.log("🔍", `页面表格配额: PC ${pageQuota.pc.progress}/${pageQuota.pc.max}`);
      }
      const candidates = [{ quota: pageQuota, data: null }];
      if (pageQuota.status !== "available") {
        const userInfo = await this.querySearchQuotaFromUserInfo();
        candidates.push(userInfo);
        if (userInfo.quota.status === "available") {
          Notice.log("🟢", "页面未命中搜索配额，使用 getuserinfo 兜底");
        } else if (RunState.token) {
          const dapi = await this.querySearchQuotaFromAPI();
          candidates.push(dapi);
          if (dapi.quota.status === "available") Notice.log("🟢", "页面未命中搜索配额，使用 DAPI 兜底");
        }
      }
      const quota = SearchQuota.select(candidates.map(candidate => candidate.quota));
      const selected = candidates.find(candidate => candidate.quota === quota);
      return { page, pageQuota, quota, data: selected?.data || null };
    },

    async getSearchQuota(maxRetries = 3) {
      return (await this.getSearchSnapshot(maxRetries)).quota;
    },

    // 汇总复用本次查询，阅读采用最近确认的进度。
    async getRewardsInfo(maxRetries = 3) {
      const { page, pageQuota, quota, data } = await this.getSearchSnapshot(maxRetries);
      if (!page) return false;
      const sourceBalance = quota.source === "getuserinfo" ? DataParsers.userInfoBalance(data)
        : quota.source === "dapi" ? DataParsers.dapiBalance(data) : null;
      const dailyOffer = RewardsPage.dailyOffer(page);
      const todayDetails = RewardsPage.activityDetails(page, pageQuota, dailyOffer);
      if (quota.source === "getuserinfo" && quota.pc && !todayDetails.some(detail => detail.title === "必应搜索")) {
        todayDetails.push({ title: "必应搜索", points: quota.pc.progress, max: quota.pc.max });
      }
      return {
        balance: DataParsers.accountBalance(sourceBalance, RewardsPage.balance(page)),
        pc: quota.pc,
        mobile: quota.mobile,
        searchStatus: quota.status,
        searchSource: quota.source,
        readProgress: ReadingState.progress,
        readMax: ReadingState.max,
        dailyOffer,
        todayDetails,
        history: RewardsPage.history(page)
      };
    },

    async querySearchQuotaFromUserInfo() {
      try {
        const data = await UserInfoSession.get();
        if (!data) return { quota: SearchQuota.create("failed", "getuserinfo"), data: null };
        const dashboard = data.dashboard || data;
        const quota = SearchQuota.fromCounters(dashboard.userStatus?.counters?.pcSearch, "getuserinfo");
        if (quota.status === "available") Notice.log("📊", `getuserinfo查询: PC ${quota.pc.progress}/${quota.pc.max}`);
        return { quota, data };
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        if (Storage.get("Config.debugDAPI", false)) Notice.log("🟡", `getuserinfo 查询失败: ${e.message}`);
        return { quota: SearchQuota.create("failed", "getuserinfo"), data: null };
      }
    },

    async querySearchQuotaFromAPI() {
      const region = Utils.isRegionLockEnabled() ? "cn" : RunState.region.toLowerCase();
      try {
        const res = await AppTokenSession.withTokenRetry(token => HttpClient.text({
          url: "https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613",
          headers: RequestHeaders.app(token, region)
        }));
        if (!Utils.isJSON(res)) return { quota: SearchQuota.create("unknown", "dapi"), data: null };
        const data = JSON.parse(res);
        const response = data?.response;
        if (!response || typeof response !== "object") return { quota: SearchQuota.create("unknown", "dapi"), data: null };
        const promos = Array.isArray(response.promotions) ? response.promotions : [];
        if (Storage.get("Config.debugDAPI", false)) {
          const promoNames = promos.map(p => p.name || p.attributes?.offerid || "?").join(", ");
          Notice.log("🔵", `DAPI promotions(${promos.length}): ${promoNames}`);
          for (let i = 0; i < Math.min(promos.length, 5); i++) {
            const p = promos[i];
            const attrs = p.attributes || {};
            const attrStr = Object.entries(attrs).map(([k, v]) => `${k}=${v}`).join(", ").slice(0, 300);
            Notice.log("🔵", `DAPI promo[${i}] ${p.name}: ${attrStr}`);
          }
        }
        const counters = response.counters || response.userStatus?.counters;
        const quota = SearchQuota.fromCounters(counters?.pcSearch, "dapi");
        if (quota.status === "available") {
          Notice.log("📊", `DAPI查询: PC ${quota.pc.progress}/${quota.pc.max}`);
        } else if (Storage.get("Config.debugDAPI", false)) {
          if (!counters) Notice.log("🟡", "DAPI 未返回 counters，搜索配额未确认");
          else if (quota.status === "zero") Notice.log("🟡", "DAPI 返回配额 0，保留未完成状态");
        }
        return { quota, data: response };
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        Notice.log("🟡", `DAPI查询失败: ${e.message}`);
        return { quota: SearchQuota.create("failed", "dapi"), data: null };
      }
    },

    // 余额先查 DAPI，再查 getuserinfo；均无有效值则返回 null。
    async getBalance() {
      const region = Utils.isRegionLockEnabled() ? "cn" : RunState.region.toLowerCase();
      try {
        const res = await AppTokenSession.withTokenRetry(token => HttpClient.text({
          url: "https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=105",
          headers: RequestHeaders.app(token, region)
        }));
        if (Utils.isJSON(res)) {
          const data = JSON.parse(res);
          const balance = DataParsers.dapiBalance(data.response);
          if (balance !== null) return balance;
        }
      } catch (e) { if (RunGuard.isStopError(e)) throw e; }

      try {
        const data2 = await UserInfoSession.get();
        if (data2) {
          const balance = DataParsers.userInfoBalance(data2);
          if (balance !== null) return balance;
        }
      } catch (e) { if (RunGuard.isStopError(e)) throw e; }

      return null;
    }
  };

  // 搜索请求、热搜词和受限追踪；批次由 doSearch 调度。
  const SearchService = {
    // 按设备选请求头和 Cookie，主任务使用桌面模式。
    async getSearchPage(query, isMobile = false) {
      const mkt = Utils.isRegionLockEnabled() ? "&mkt=zh-CN" : "";
      const deviceType = isMobile ? "m" : "d";
      return HttpClient.text({
        url: `https://${RunState.host}/search?q=${encodeURIComponent(query)}&form=QBLH${mkt}`,
        headers: {
          "user-agent": isMobile ? RewardsAuto.ua.mobile : RewardsAuto.ua.pc,
          "cookie": `_Rwho=u=${deviceType}&ts=${RunState.dateNowStr}`,
          "referer": `https://${RunState.host}/?form=QBLH`
        }
      });
    },

    // 搜索后提交两种上报，积分由后续配额查询确认。
    async reportSearch(query, isMobile = false) {
      try {
        const ig = Utils.getRandomUUID();
        const mkt = Utils.isRegionLockEnabled() ? "&mkt=zh-CN" : "";
        const params = `q=${encodeURIComponent(query)}&form=QBLH${mkt}`;
        const deviceType = isMobile ? "m" : "d";
        const headers = {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "user-agent": isMobile ? RewardsAuto.ua.mobile : RewardsAuto.ua.pc,
          "referer": `https://${RunState.host}/?form=QBLH`,
          "cookie": `_Rwho=u=${deviceType}&ts=${RunState.dateNowStr}`
        };

        await HttpClient.text({
          method: "POST",
          url: `https://${RunState.host}/rewardsapp/ncheader?ver=88888888&IID=SERP.5047&IG=${ig}&ajaxreq=1`,
          headers,
          data: "wb=1%3bi%3d1%3bv%3d1"
        });
        await HttpClient.text({
          method: "POST",
          url: `https://${RunState.host}/rewardsapp/reportActivity?IG=${ig}&IID=SERP.5047&${params}&ajaxreq=1`,
          headers,
          data: `url=${encodeURIComponent(`https://${RunState.host}/search?${params}`)}&V=web`
        });
        return true;
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        Notice.log("🟡", `搜索上报失败: ${e.message}`);
        return false;
      }
    },

    // 在线词源获取失败时，回退到内置词库。
    async getHotSearchWord() {
      if (RewardsAuto.apiConfig.mode === "online") {
        if (SearchState.wordIndex < 1 || SearchState.wordList.length < 1) {
          // 随机轮换来源，跳过上次接口并保存索引。
          const sources = RewardsAuto.apiConfig.sources;
          const lastApiIndex = parseInt(Storage.get("Config.apiIndex", -1));
          const candidates = sources
            .map((entry, index) => ({ entry, index }))
            .filter(item => item.index !== lastApiIndex);
          const selected = candidates[Utils.randomRange(0, candidates.length - 1)];
          Storage.set("Config.apiIndex", selected.index);

          const apiConfig = selected.entry;

          try {
            const hotSource = apiConfig.hot[Utils.randomRange(0, apiConfig.hot.length - 1)];
            const result = await HttpClient.text({ url: apiConfig.url + hotSource });
            if (result && Utils.isJSON(result)) {
              const res = JSON.parse(result);
              if (res.code == 200) {
                SearchState.wordIndex = 1;
                SearchState.wordList = [];
                for (let i = 0; i < res.data.length; i++) {
                  SearchState.wordList.push(res.data[i].title);
                }
                // 打乱词列表，随机截短标题。
                SearchState.wordList.sort(() => Math.random() - 0.5);
                const sentence = SearchState.wordList[SearchState.wordIndex];
                if (typeof sentence === "string" && sentence.trim()) {
                  return sentence.substring(0, Utils.randomRange(20, 32));
                }
              }
            }
          } catch (e) {
            if (RunGuard.isStopError(e)) throw e;
            Notice.log("🟡", `热搜词获取失败: ${e.message}`);
          }
        } else {
          SearchState.wordIndex++;
          if (SearchState.wordIndex > SearchState.wordList.length - 1) {
            SearchState.wordIndex = 0;
          }
          const sentence = SearchState.wordList[SearchState.wordIndex];
          if (typeof sentence === "string" && sentence.trim()) {
            return sentence.substring(0, Utils.randomRange(20, 32));
          }
        }
        Notice.log("🟡", "热搜词接口异常，已从内置词库随机选词");
      }
      return RewardsAuto.searchPool[Utils.randomRange(0, RewardsAuto.searchPool.length - 1)];
    },

    // 恢复当天搜索状态。
    restoreSearchTracking() {
      const today = Utils.getTodayNum();
      const sameDay = Number(Storage.get("Config.searchTrackingDate", 0)) === today;
      const progress = Number(Storage.get("Config.lastSearchProgress", -1));
      const times = Number(Storage.get("Config.restrictedTimes", 0));
      SearchState.searchTrackingDate = today;
      SearchState.lastSearchProgress = sameDay && Number.isSafeInteger(progress) && progress >= 0 ? progress : -1;
      SearchState.restrictedTimes = sameDay && SearchState.lastSearchProgress >= 0
        && Number.isSafeInteger(times) && times >= 0 ? times : 0;
    },

    // 服务器进度连续 3 次未增长时暂停搜索。
    async checkSearchRestricted(info, countNoProgress = true) {
      if (info === undefined) info = await RewardsQuery.getSearchQuota();
      if (!SearchQuota.hasProgress(info)) return false;
      if (SearchState.searchTrackingDate !== Utils.getTodayNum()) this.restoreSearchTracking();
      const currentTotal = info.pc.progress;
      const lastTotal = SearchState.lastSearchProgress;

      // 启动查询只建基线，搜索后核验才计未增长次数。
      if (!countNoProgress && currentTotal !== lastTotal) {
        SearchState.restrictedTimes = 0;
      } else if (lastTotal !== -1) {
        if (currentTotal <= lastTotal && currentTotal < info.pc.max) {
          if (countNoProgress) SearchState.restrictedTimes++;
        } else {
          SearchState.restrictedTimes = 0;
        }
      }

      // 批次核验保留最高进度，避免回落恢复被误算为增长。
      SearchState.lastSearchProgress = countNoProgress ? Math.max(currentTotal, lastTotal) : currentTotal;
      Storage.set("Config.lastSearchProgress", SearchState.lastSearchProgress);
      Storage.set("Config.restrictedTimes", SearchState.restrictedTimes);
      Storage.set("Config.searchTrackingDate", SearchState.searchTrackingDate);

      if (SearchState.restrictedTimes >= 3) {
        Notice.log("🔴", "搜索连续 3 次核验未增长，可能受限或暂未入账，已暂停搜索（保留未完成状态）", true);
        return true;
      }
      return false;
    },

    // 配额已满时清除受限追踪，完成日期由任务层保存。
    clearCompletedTracking() {
      SearchState.restrictedTimes = 0;
      SearchState.lastSearchProgress = -1;
      Storage.set("Config.restrictedTimes", 0);
      Storage.set("Config.lastSearchProgress", -1);
    }
  };

  // 活动提交与响应解析，供 PC 签到和 Dashboard 领取使用。
  const ActivityService = {
    // 返回成功、失败或未知，完成判定由调用方决定。
    activityResponseResult(response, serverAction = false) {
      const inspect = (value, depth = 0) => {
        if (depth > 4 || value == null) return null;
        if (typeof value === "string") {
          const text = value.trim();
          if (!text) return null;
          try { return inspect(JSON.parse(text), depth + 1); } catch (_) {}
          if (/(?:"|')?(?:error|failure|failed)(?:"|')?\s*[:=]\s*(?:true|1)/i.test(text)
            || /(?:"|')?success(?:"|')?\s*[:=]\s*(?:false|0)/i.test(text)) return false;
          if (/(?:"|')?(?:success|succeeded|claimed|isClaimed|ok)(?:"|')?\s*[:=]\s*(?:true|1)/i.test(text)) return true;
          return null;
        }
        if (typeof value === "boolean") return value;
        if (Array.isArray(value)) {
          for (const item of value) {
            const result = inspect(item, depth + 1);
            if (result !== null) return result;
          }
          return null;
        }
        if (typeof value !== "object") return null;
        if (value.error || value.failure || value.failed || value.success === false || value.ok === false) return false;
        if (value.success === true || value.succeeded === true || value.claimed === true
          || value.isClaimed === true || value.ok === true || value.isDuplicate === true
          || value.activity) return true;
        for (const key of ["response", "data", "result", "props", "tree"]) {
          const result = inspect(value[key], depth + 1);
          if (result !== null) return result;
        }
        return null;
      };
      if (!serverAction) return inspect(response);

      // 优先跟随 RSC 根记录的 a 引用，解析最终结果。
      const records = new Map();
      const rawResponse = String(response == null ? "" : response)
        .replace(/^\uFEFF/, "")
        .replace(/\u001e/g, "\n")
        .replace(/\r\n?/g, "\n");
      for (const line of rawResponse.split("\n")) {
        const match = line.trim().match(/^([0-9a-z]+)\s*:\s*(.*)$/i);
        if (!match) continue;
        const id = match[1].toLowerCase();
        const payload = match[2].trim();
        if (!payload) continue;
        try {
          records.set(id, payload.startsWith("E{")
            ? { error: true }
            : JSON.parse(payload));
        } catch (_) {
          // 忽略无法解析的记录，保留未知状态。
        }
      }

      const resolveRecord = (value, depth = 0) => {
        if (depth > 8 || value == null) return null;
        if (typeof value === "string") {
          const ref = value.trim().match(/^\$@?([0-9a-z]+)$/i);
          if (ref && records.has(ref[1].toLowerCase())) {
            return resolveRecord(records.get(ref[1].toLowerCase()), depth + 1);
          }
        }
        if (value && typeof value === "object" && !Array.isArray(value)) {
          // 兼容结果包装，并限制引用深度。
          for (const key of ["a", "response", "data", "result"]) {
            if (!(key in value)) continue;
            const result = resolveRecord(value[key], depth + 1);
            if (result !== null) return result;
          }
        }
        return inspect(value, depth);
      };

      if (records.has("0")) {
        const result = resolveRecord(records.get("0"));
        if (result !== null) return result;
      }

      // 根记录无法判断时，再检查其他记录。
      for (const value of records.values()) {
        const result = resolveRecord(value);
        if (result === true || result === false) return result;
      }

      // 非 RSC 响应按 JSON 或文本标记解析。
      return inspect(response);
    },

    async getRequestVerificationToken(pageUrl = "https://rewards.bing.com/") {
      // 仅从 Rewards 来源页取 Token，不能使用卡片目标站点。
      try {
        const sourceUrl = new URL(pageUrl, "https://rewards.bing.com/");
        if (sourceUrl.origin !== "https://rewards.bing.com") {
          throw new Error("验证令牌只能从 Rewards 来源页获取");
        }
        const html = await HttpClient.text({
          url: sourceUrl.href,
          headers: {
            "user-agent": RewardsAuto.ua.pc,
            "referer": "https://rewards.bing.com/"
          },
          anonymous: false
        });
        const tokenMatch = html.match(/name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i)
          || html.match(/RequestVerificationToken.*?value=["']([^"']+)["']/i)
          || html.match(/"verificationToken"\s*:\s*"([^"]+)"/i)
          || html.match(/"__RequestVerificationToken"\s*:\s*"([^"]+)"/i);
        return tokenMatch ? tokenMatch[1].replace(/&amp;/g, "&") : "";
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        Notice.log("🟡", `活动Token获取失败: ${e.message}`);
        return "";
      }
    },

    // 取来源页令牌后提交，响应由业务调用方解释。
    async reportActivity(offerId, hash, referer = "https://rewards.bing.com/") {
      const sourceUrl = new URL(referer, "https://rewards.bing.com/");
      if (sourceUrl.origin !== "https://rewards.bing.com") {
        throw new Error("活动提交来源必须是 Rewards 页面");
      }
      const source = sourceUrl.href;
      const token = await this.getRequestVerificationToken(source);
      if (!token) throw new Error("来源页未提供 RequestVerificationToken");
      const params = new URLSearchParams({
        id: offerId,
        hash: hash || "1",
        activityAmount: "1"
      });
      if (token) params.set("__RequestVerificationToken", token);

      const headers = {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "user-agent": RewardsAuto.ua.pc,
        "referer": source,
        "origin": "https://rewards.bing.com",
        "x-requested-with": "XMLHttpRequest"
      };
      if (token) headers["RequestVerificationToken"] = token;

      return await HttpClient.text({
        method: "POST",
        url: "https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest",
        headers,
        data: params.toString(),
        anonymous: false
      });
    }
  };

  // 签到接口：返回积分供任务层判定，失败为 -1。
  const AppSignIn = {
    async signApp() {
      const region = Utils.isRegionLockEnabled() ? "cn" : RunState.region.toLowerCase();
      try {
        const res = await AppTokenSession.withTokenRetry(token => HttpClient.text({
          method: "POST",
          url: "https://prod.rewardsplatform.microsoft.com/dapi/me/activities",
          headers: RequestHeaders.app(token, region, {
            "x-rewards-partnerid": "startapp",
            "x-rewards-flights": "rwgobig"
          }),
          data: JSON.stringify({
            amount: 1, id: Utils.getRandomUUID() + Utils.getRandomUUID().slice(0, 24),
            type: 103,
            country: region,
            channel: RewardsAuto.appConfig.channel
          })
        }));
        if (Utils.isJSON(res)) {
          const data = JSON.parse(res);
          const response = data.response || {};
          if (response.activity) return Number(response.activity.p || response.activity.points || 0);
          if (response.isDuplicate || response.activity === null) return 0;
          Notice.log("🟡", `App签入响应未确认: ${String(res).slice(0, 120)}`);
        }
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        Notice.log("🔴", `App签入失败: ${e.message}`);
      }
      return -1;
    },

    // 已知兼容限制（用户确认，2026-10-01）：PC 签到暂保留现有判定。
    // JSON 无积分时按 0 分记完成，success:false 也可能误判。
    // 收紧前需实测成功、重复及失败响应，保留 0 分兼容。
    async signPC() {
      try {
        const res = await ActivityService.reportActivity("Gamification_DailyCheckIn", "1", "https://rewards.bing.com/");
        if (Utils.isJSON(res)) {
          const data = JSON.parse(res);
          RunState.pc401 = false;
          return Number(data.points || data.response?.activity?.p || 0);
        }
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        if (e.message?.includes("401")) RunState.pc401 = true;
        Notice.log("🟡", `PC签入失败: ${e.message}`);
      }
      return -1;
    }
  };

  // 按 Bing 地区信息检查锁区，非大陆按天提醒。
  const RegionService = {
    async checkRegion(retryCount = 0) {
      if (!Utils.isRegionLockEnabled()) {
        Notice.log("🔓", "锁定国区已关闭：跳过地区检查，不强制国区参数");
        return true;
      }
      if (retryCount === 0) Notice.log("🔒", "锁定国区已开启：检查大陆 IP");
      try {
        const html = await HttpClient.text({ url: `https://${RunState.host}/` });
        if (!Utils.isRegionLockEnabled()) return true;
        if (!html) {
          if (retryCount < 2) {
            Notice.log("🟡", `地区检测返回空，第${retryCount + 1}次重试...`);
            await Wait.randomDelay(3000, 8000);
            return await this.checkRegion(retryCount + 1);
          }
          Notice.log("🔴", "地区检测失败（无响应）");
          return false;
        }
        const match = html.replace(/\s/g, "").match(/Region:"(.*?)"(.*?)RevIpCC:"(.*?)"/);
        if (match) {
          RunState.region = match[3].toUpperCase();
          if (RunState.region !== "CN") {
            await this.getIPInfo();
            if (!Utils.isRegionLockEnabled()) return true;
            Notice.notifyNonDomesticIp(`IP非大陆(${RunState.region})，已停止\n${RunState.ipInfo}`);
            return false;
          }
          Storage.set("Config.ipPauseNoticeDate", 0);
          Notice.log("🟢", `地区检测通过: ${RunState.region}`);
          return true;
        }
        // 页面不匹配时按地区未知处理。
        if (retryCount < 2) {
          Notice.log("🟡", `地区检测格式异常，第${retryCount + 1}次重试...`);
          await Wait.randomDelay(3000, 8000);
          return await this.checkRegion(retryCount + 1);
        }
        Notice.log("🔴", "地区检测失败（格式不匹配）");
        return false;
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        if (!Utils.isRegionLockEnabled()) return true;
        if (retryCount < 2) {
          Notice.log("🟡", `地区检测异常: ${e.message}，第${retryCount + 1}次重试...`);
          await Wait.randomDelay(3000, 8000);
          return await this.checkRegion(retryCount + 1);
        }
        Notice.log("🔴", `地区检测失败: ${e.message}`);
        return false;
      }
    },

    async getIPInfo() {
      try {
        const qryResult = await HttpClient.text({
          url: "https://disp-qryapi.3g.qq.com/v1/dispatch",
          headers: { "referer": "https://3g.qq.com/" }
        });
        if (qryResult && Utils.isJSON(qryResult)) {
          const resJSON = JSON.parse(qryResult);
          let rawInfo = (resJSON.code == 0 && resJSON.ipInfo) ? String(resJSON.ipInfo) : "";
          rawInfo = rawInfo.replace(/[#*]+/g, " ").trim();
          RunState.ipInfo = rawInfo ? `🌏所在地区：${rawInfo}` : "";
        }
      } catch {
        console.debug("获取附加 IP 信息失败");
      }
    }
  };

  const DashboardTabs = {
    key: "Config.dashboardOpenLock", ttl: 10 * 60 * 1000, cooldown: 60 * 1000,
    requested: false,
    makeLockId: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    async openOnce() {
    await WebSession.ensure();
    if (DashboardTabs.requested) {
      Notice.log("📅", "本轮已请求打开 dashboard，跳过重复打开");
      return false;
    }

    const now = Date.now();
    const currentLock = await Storage.get(DashboardTabs.key, null);
    if (currentLock && Number(currentLock.expiresAt) > now) {
      DashboardTabs.requested = true;
      Notice.log("📅", "已有 dashboard 开页请求，跳过重复打开");
      return false;
    }

    const lockId = DashboardTabs.makeLockId();
    DashboardTabs.requested = true;
    await Storage.set(DashboardTabs.key, {
      id: lockId,
      createdAt: now,
      force: RunState.forceRun === true,
      sessionResetId: SessionGuard.resetId,
      expiresAt: now + DashboardTabs.ttl
    });

    const confirmedLock = await Storage.get(DashboardTabs.key, null);
    if (!confirmedLock || confirmedLock.id !== lockId) {
      Notice.log("📅", "其他页面已取得 dashboard 锁，跳过重复打开");
      return false;
    }

    try {
      await WebSession.ensure();
      await Platform.openTab(`https://rewards.bing.com/dashboard?ref=rewardspanel#rauto=${encodeURIComponent(lockId)}`, {
        active: false,
        insert: true
      });
      return true;
    } catch (e) {
      DashboardTabs.requested = false;
      const latestLock = await Storage.get(DashboardTabs.key, null);
      if (latestLock?.id === lockId) await Storage.set(DashboardTabs.key, null);
      throw e;
    }

    }
  };

  // 页面活动的识别、点击与 DOM 状态判断。
  const ActivityPage = {
    dailySetSelector: 'a[href*="rnoreward=1"]',

    completed(link, ignoreCase = false) {
      const text = link.textContent || "";
      return ignoreCase ? /已完成|Completed/i.test(text) : text.includes("已完成") || text.includes("Completed");
    },

    dailyLinks(incompleteOnly = false, ignoreCase = false) {
      if (typeof Platform.document === "undefined") return [];
      return Array.from(Platform.document.querySelectorAll(this.dailySetSelector))
        .filter(link => !new URL(link.href, Platform.location.href).pathname.startsWith("/redeem"))
        .filter(link => !incompleteOnly || !this.completed(link, ignoreCase));
    },

    title(link, fallbackWhenEmpty = true) {
      const title = link.querySelector("p");
      return fallbackWhenEmpty ? title?.textContent?.trim()?.substring(0, 30) || "未知活动"
        : title ? title.textContent.trim().substring(0, 30) : "未知活动";
    },

    offerId(href) {
      const match = href.match(/BTDSUOID[^"]*?(\w+_\d{8}_Child\d+)/i);
      return match ? match[1] : href.slice(0, 80);
    },

    async click(link) {
      await WebSession.ensure();
      link.click();
    },

    // 跳过已完成或已尝试链接；processedIds 只记录点击。
    async clickDailySetLinks(processedIds) {
      let clickCount = 0;

      try {
        await Wait.element(this.dailySetSelector, 15000);
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        Notice.log("🟡", "等待活动链接超时，页面可能未加载完成");
      }

      const allLinks = this.dailyLinks();
      Notice.log("📅", `找到 ${allLinks.length} 个每日活动链接`);

      for (const link of allLinks) {
        const href = link.href || "";

        if (this.completed(link)) {
          Notice.log("📅", `跳过已完成活动`);
          continue;
        }

        const title = this.title(link, false);

        const offerId = this.offerId(href);
        if (processedIds.has(offerId)) continue;

        Notice.log("📅", `点击活动: ${title}`);
        await Wait.randomDelay(3000, 8000);

        try {
          // 原生 click 的打开方式由网站决定。
          await this.click(link);
          clickCount++;
          processedIds.add(offerId);
          await Wait.randomDelay(3000, 8000);
        } catch (e) {
          if (RunGuard.isStopError(e)) throw e;
          Notice.log("🟡", `点击活动失败: ${e.message}`);
        }
      }
      return clickCount;
    },

    // Dashboard 每日活动：点击后复查页面。
    async clickDashboardDailySet() {
      try {
        await Wait.delay(3000);
        await WebSession.ensure();

        const incompleteLinks = this.dailyLinks(true);

        Notice.log("📅", `找到 ${incompleteLinks.length} 个未完成的每日活动`);
        let clickCount = 0;

        for (const link of incompleteLinks) {
          await WebSession.ensure();
          const title = this.title(link);
          Notice.log("📅", `点击活动: ${title}`);
          await Wait.delay(3000 + Math.random() * 5000);
          await this.click(link);
          clickCount++;
          await Wait.delay(3000 + Math.random() * 5000);
        }

        await Wait.delay(1500);
        await WebSession.ensure();
        // 兼容规则：Dashboard 未完成链接为零即完成。
        // 未校验活动区，也未复查 /earn 的 dailyset 数据。
        const remainingLinks = this.dailyLinks(true);
        const completed = remainingLinks.length === 0;
        if (completed) {
          Notice.log("📅", `页面未检测到未完成的每日活动（已尝试点击 ${clickCount} 项）`);
        } else {
          Notice.log("🟡", `每日活动仍有 ${remainingLinks.length} 个链接未确认完成，暂不关闭页面`);
        }
        return { completed, clicked: clickCount, remaining: remainingLinks.length };
      } catch (e) {
        Notice.log("🟡", `每日活动点击失败: ${e.message}`);
        return { completed: false, clicked: 0, remaining: -1 };
      }
    },

    punchCardSelectors: [
      "a[href*='punchcard']", "a[href*='quest']",
      "a[data-rac][href*='earn']", "a.cursor-pointer[href]",
      "a.group\\/ctrl",
      "a[href*='/earn/quest/']",
      "a[href*='promotional']",
      "a[data-bi-id][href*='earn']",
    ],
    textPatterns: ["盗贼之海", "五月亮点来袭", "每日活动", "Daily Set", "限时活动", "特别活动"],

    detailTextPatterns: [
      "关注赛事", "访问网站", "开始搜索",
      "发现", "探索", "获取", "Learn more", "了解更多",
      "Start", "Begin", "Watch", "View", "Check",
      "立即开始", "立即参与", "立即前往", "立即访问",
      "参加活动", "参与活动", "前往活动"
    ],

    // 详情页每天最多点击 5 次，计数不代表服务器进度。
    async clickDetailTasks() {
      const today = Utils.getTodayNum();
      const detailStateKey = "Config.punchCardDetailState";
      const detailDateKey = "Config.punchCardDetailDate";
      const savedDate = Storage.get(detailDateKey, 0);
      let currentDetailState = 0;

      if (savedDate === today) {
        currentDetailState = Storage.get(detailStateKey, 0);
      } else {
        Storage.set(detailStateKey, 0);
        Storage.set(detailDateKey, today);
      }

      if (currentDetailState >= 5) {
        console.log("[Rewards Auto] 详情页任务今日已全部点击完成");
        return true;
      }

      console.log(`[Rewards Auto] 开始执行详情页任务点击，当前状态: ${currentDetailState}/5`);
      await Wait.randomDelay(3000, 8000);

      // 优先匹配任务文案，否则用首个可用按钮。
      const enabledButtons = Platform.document.querySelectorAll(
        "a[data-rac][target='_blank']:not([aria-disabled='true']):not([data-disabled='true'])"
      );
      const disabledButtons = Platform.document.querySelectorAll(
        "a[data-rac][target='_blank'][aria-disabled='true'][data-disabled='true']"
      );

      console.log(`[Rewards Auto] 找到 ${enabledButtons.length} 个可用按钮，${disabledButtons.length} 个禁用按钮`);

      let clickableButton = null;

      for (const btn of enabledButtons) {
        const text = btn.textContent || "";
        const ariaLabel = btn.getAttribute("aria-label") || "";
        if (this.detailTextPatterns.some(pattern => text.includes(pattern) || ariaLabel.includes(pattern))) {
          clickableButton = btn;
          break;
        }
      }

      if (!clickableButton && enabledButtons.length > 0) {
        clickableButton = enabledButtons[0];
      }

      if (!clickableButton) {
        console.log("[Rewards Auto] 未找到可用任务按钮，本页暂不继续点击");
        return true;
      }

      const buttonText = clickableButton.textContent || "未知任务";
      console.log(`[Rewards Auto] 准备点击任务按钮: "${buttonText}"`);

      await Wait.randomDelay(3000, 8000);

      try {
        await this.click(clickableButton);
        console.log(`[Rewards Auto] 已点击任务按钮: "${buttonText}"`);
        // 点击后记录次数，用于跨页去重。
        Storage.set(detailStateKey, currentDetailState + 1);
        Storage.set(detailDateKey, today);
        await Wait.randomDelay(3000, 8000);
        return true;
      } catch (clickError) {
        console.error(`[Rewards Auto] 点击任务按钮失败: ${clickError.message}`);
        return false;
      }
    },

    // 主页每天最多点击 2 项，并限制递归深度。
    async clickPunchCards(depth = 0) {
      if (depth > 5) {
        console.log("[Rewards Auto] 打卡递归深度超限，停止");
        return;
      }
      const today = Utils.getTodayNum();
      const stateKey = "Config.punchCardState";
      const dateKey = "Config.punchCardDate";
      const savedDate = Storage.get(dateKey, 0);
      let state = savedDate === today ? Storage.get(stateKey, 0) : 0;

      if (state >= 2) {
        console.log("[Rewards Auto] 打卡任务已完成");
        return;
      }

      console.log(`[Rewards Auto] 打卡任务: ${state}/2`);
      await Wait.randomDelay(3000, 8000);

      let found = [];
      // 依次等待各选择器，命中后停止查找。
      for (const sel of this.punchCardSelectors) {
        try {
          found = await Wait.elementsByText(sel, this.textPatterns, 10000);
          if (found.length > 0) break;
        } catch {}
      }

      if (found.length === 0) {
        console.log("[Rewards Auto] 未找到打卡卡片");
        return;
      }

      if (state < found.length) {
        const target = found[state];
        console.log(`[Rewards Auto] 点击: ${target.pattern}`);
        await Wait.randomDelay();
        try {
          await this.click(target.element);
          Storage.set(stateKey, state + 1);
          Storage.set(dateKey, today);
          if (state + 1 < 2) {
            await Wait.randomDelay(5000, 10000);
            await this.clickPunchCards(depth + 1);
          }
        } catch (e) {
          console.error(`[Rewards Auto] 点击失败: ${e.message}`);
        }
      }
    },

  };

  // 任务记录：只合并本轮变化。
  const TaskRecords = {
    load(target) {
      const tasks = Storage.get("Config.tasks", {});
      target.signDate = tasks.sign || 0;
      target.readDate = tasks.read || 0;
      target.promosDate = tasks.promos || 0;
      target.searchDate = tasks.search || 0;
      target.streakDays = tasks.streakDays || 0;
      target.signPoint = Storage.get("Config.signPoint", -1);
      target.signTimes = target.readTimes = 0;
      target.savedTasks = {
        sign: tasks.sign || 0, read: tasks.read || 0, promos: tasks.promos || 0,
        search: tasks.search || 0, streakDays: tasks.streakDays || 0
      };
    },

    save(target) {
      RunGuard.assertActive();
      const values = {
        sign: target.signDate, read: target.readDate, promos: target.promosDate,
        search: target.searchDate, streakDays: target.streakDays
      };
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        if (value !== target.savedTasks?.[key]) changes[key] = value;
      }
      // 存储合并非原子操作，跨页互斥依赖运行锁。
      Storage.set("Config.tasks", { ...Storage.get("Config.tasks", {}), ...changes });
      target.savedTasks = values;
    },

    saveSignPoint(value) {
      RunGuard.assertActive();
      Storage.set("Config.signPoint", value);
    }
  };

  // 任务执行：更新状态并返回结果。
  const TaskActions = {
    // App 或 PC 返回非负积分即记完成；PC 限制见 signPC。
    async doSign() {
      if (!Storage.get("Tasks.sign", true)) return TaskResult.create("skipped", "sign_disabled");
      if (TaskState.signTimes > 2) return TaskResult.create("failed", "sign_attempts_exhausted");
      if (TaskState.signPoint >= 0 && TaskState.signDate === RunState.dateNowNum) {
        Notice.log("✅", `签入已完成(${TaskState.signPoint}积分)`);
        return TaskResult.create("completed", "sign_already_completed");
      }

      await Wait.randomDelay();

      let totalPoint = 0;
      let signOk = false;

      const appPoint = await AppSignIn.signApp();
      if (appPoint >= 0) {
        signOk = true;
        if (appPoint > 0) {
          Platform.log(`📱 App签入静默成功 +${appPoint}积分`);
          totalPoint += appPoint;
        } else {
          Platform.log("📱 App签入已确认，无新增积分");
        }
      }

      await Wait.randomDelay(3000, 8000);
      const pcPoint = await AppSignIn.signPC();
      if (pcPoint >= 0) {
        signOk = true;
        Notice.log("💻", `PC签入成功！+${pcPoint}积分`);
        totalPoint += pcPoint;
      }

      if (signOk) {
        TaskState.signPoint = totalPoint;
        TaskState.signDate = RunState.dateNowNum;
        TaskRecords.saveSignPoint(totalPoint);
        TaskRecords.save(TaskState);
        Notice.log("🔵", `签入任务完成！总积分 +${totalPoint}`, true);
        return TaskResult.create("completed", "sign_confirmed");
      } else {
        TaskState.signTimes++;
        Notice.log("🟡", `签入失败，稍后重试`);
        return TaskResult.create("failed", "sign_failed", true);
      }
    },

    // 阅读完成日期须经服务器进度复核。
    async doRead() {
      if (!Storage.get("Tasks.read", true)) return TaskResult.create("skipped", "read_disabled");
      if (TaskState.readTimes > 2) return TaskResult.create("failed", "read_attempts_exhausted");
      if (TaskState.readDate === RunState.dateNowNum) {
        const verifyProgress = await ReadingService.getReadProgress();
        if (verifyProgress && verifyProgress.progress >= verifyProgress.max) {
          Notice.log("✅", `阅读任务已完成（已验证 ${verifyProgress.progress}/${verifyProgress.max}）`);
          return TaskResult.create("completed", "read_verified");
        } else if (verifyProgress) {
          // 进度未满时撤回本地完成记录。
          Notice.log("🟡", `阅读标记有误（${verifyProgress.progress}/${verifyProgress.max}），重置并继续`);
          TaskState.readDate = 0;
          TaskRecords.save(TaskState);
        } else {
          TaskState.readTimes++;
          Notice.log("🟡", "无法验证阅读进度，稍后重试");
          return TaskResult.create("unknown", "read_verification_unavailable", true);
        }
      }

      const progress = await ReadingService.getReadProgress();
      if (!progress) {
        TaskState.readTimes++;
        Notice.log("🟡", "无法获取阅读进度，稍后重试");
        return TaskResult.create("unknown", "read_progress_unavailable", true);
      }

      const { progress: cur, max } = progress;
      Notice.log("📖", `阅读进度: ${cur}/${max}`);

      if (cur >= max) {
        TaskState.readDate = RunState.dateNowNum;
        TaskRecords.save(TaskState);
        Notice.log("✅", "阅读任务已完成");
        return TaskResult.create("completed", "read_verified");
      }

      let successCount = 0;
      // 每次最多补读 10 篇，最终查进度判断完成。
      const maxPerDay = 10;
      const remaining = Math.min(max - cur, maxPerDay);
      Notice.log("📖", `今日还可阅读 ${remaining} 篇（上限 ${maxPerDay} 篇/天）`);

      for (let i = 0; i < remaining; i++) {
        const result = await ReadingService.doRead();
        if (!result) { Notice.log("🟡", `阅读第 ${i + 1} 篇失败，中止`); break; }
        successCount++;
        Notice.log("📖", `阅读文章 ${i + 1}/${remaining} +${result.points}积分`);
        await Wait.randomDelay(3000, 8000);
      }

      if (successCount === 0) {
        TaskState.readTimes++;
        Notice.log("🟡", "阅读全部失败，稍后重试");
        return TaskResult.create("failed", "read_submissions_failed", true);
      }

      // 最终进度达标才保存完成日期。
      const verify = await ReadingService.getReadProgress();
      if (verify && verify.progress >= verify.max) {
        TaskState.readDate = RunState.dateNowNum;
        TaskRecords.save(TaskState);
        Notice.log("🔵", `阅读任务完成！共 ${successCount} 篇`, true);
        return TaskResult.create("completed", "read_verified");
      } else {
        TaskState.readTimes++;
        Notice.log("🟡", `阅读已执行但未完成，稍后复查`);
        return TaskResult.create(verify ? "pending" : "unknown", verify ? "read_incomplete" : "read_verification_unavailable", true);
      }
    },

    // 卡片按 offerId 去重；二次扫描只提交本轮新卡片。
    async doPromos(secondScan = false) {
      if (!Storage.get("Tasks.promos", true)) return TaskResult.create("skipped", "promos_disabled");
      Notice.log(secondScan ? "🔄" : "🧩", secondScan ? "二次扫描：检查是否有新解锁的卡片..." : "扫描活动卡片...");
      let scan = await CardService.discoverCards();
      if (!scan.ok) {
        TaskState.promosDate = 0;
        TaskRecords.save(TaskState);
        Notice.log("🟡", "活动状态查询失败，保留未完成状态");
        return TaskResult.create("unknown", "card_scan_unavailable");
      }
      const enabled = card => card.kind !== "quiz" || Storage.get("Tasks.quiz", true);
      const pending = scan.cards.filter(enabled);
      if (pending.length && !scan.actionReady) {
        TaskState.promosDate = 0;
        TaskRecords.save(TaskState);
        Notice.log("🟡", "当前官网 reportActivity ID 未确认，活动卡片保留未完成，稍后重新识别");
        return TaskResult.create("unknown", "card_action_unavailable");
      }
      const fresh = pending.filter(card => !TaskState.cardAttempted.has(CardService.cardKey(card)));
      Notice.log("🧩", secondScan
        ? `二次扫描：${fresh.length} 个新卡片，${pending.length - fresh.length} 个本轮已尝试`
        : `发现 ${pending.length} 个待完成卡片（已按活动编号去重）`);
      for (const card of fresh) {
        const key = CardService.cardKey(card);
        TaskState.cardAttempted.add(key);
        TaskState.cardResults.set(key, false);
        Notice.log("  ", `[${card.kind}] ${card.title} +${card.points}p`);
        await Wait.randomDelay(3000, 8000);
        TaskState.cardResults.set(key, await CardService.claimCard(card) === true);
      }
      // 提交后整批复查，吸收延迟入账和页面完成结果。
      if (fresh.length) scan = await CardService.discoverCards({ quiet: true, resolveAction: false });
      if (scan?.ok) {
        for (const key of TaskState.cardResults.keys()) {
          const completed = scan.states.get(key)?.isCompleted;
          if (typeof completed === "boolean") TaskState.cardResults.set(key, completed);
        }
      }
      const ok = [...TaskState.cardResults.values()].filter(Boolean).length;
      const unconfirmed = TaskState.cardResults.size - ok;
      const count = scan.cards.filter(enabled).length;
      // 扫描成功、无待办且本轮尝试均确认，才记完成。
      TaskState.promosDate = scan?.ok && count === 0 && unconfirmed === 0 ? RunState.dateNowNum : 0;
      TaskRecords.save(TaskState);
      Notice.log(TaskState.promosDate ? "✅" : "🟡", TaskState.promosDate
        ? `活动卡片已验证完成，本轮 ${ok} 个已确认`
        : `活动卡片尚未完成：本轮 ${ok} 个已确认/${unconfirmed} 个未确认；${scan?.ok ? `服务器还有 ${count} 个待完成` : "最终状态查询失败"}`, !secondScan);
      if (TaskState.promosDate) return TaskResult.create("completed", "cards_verified");
      const unknown = !scan?.ok || [...TaskState.cardResults].some(([key, completed]) =>
        !completed && typeof scan.states.get(key)?.isCompleted !== "boolean");
      return TaskResult.create(unknown ? "unknown" : "pending", unknown ? "card_completion_unavailable" : "cards_incomplete");
    },

    // 搜索完成以服务器配额为准。
    async doSearch() {
      if (!Storage.get("Tasks.search", true)) return TaskResult.create("skipped", "search_disabled");

      let info = await RewardsQuery.getSearchQuota();
      RunGuard.assertActive();
      if (!SearchQuota.hasProgress(info)) {
        TaskState.searchDate = 0;
        TaskRecords.save(TaskState);
        Notice.log("🔴", "无法获取有效搜索配额，暂停本轮搜索（保留未完成状态）");
        const reason = { zero: "search_quota_zero", missing: "search_quota_missing", failed: "search_query_failed" };
        return TaskResult.create("unknown", reason[info?.status] || "search_quota_unavailable");
      }

      if (info.pc.progress < info.pc.max) {
        Notice.log("🔍", `搜索配额: PC ${info.pc.progress}/${info.pc.max}`);
        if (TaskState.searchDate === RunState.dateNowNum) {
          Notice.log("🟡", "搜索配额未满，继续执行搜索任务");
        }
        TaskState.searchDate = 0;
        TaskRecords.save(TaskState);
        if (await SearchService.checkSearchRestricted(info, false)) return TaskResult.create("pending", "search_restricted");
      }

      // 每次按 3 分估算，每批最多 5 次；批末查配额。
      const pointsPerSearch = 3;
      const searchesPerCheck = 5;
      let searchCount = 0;
      while (info.pc.progress < info.pc.max) {
        const searchesNeeded = Math.ceil((info.pc.max - info.pc.progress) / pointsPerSearch);
        const batchSize = Math.min(searchesPerCheck, searchesNeeded);
        const searchTotal = searchCount + searchesNeeded;
        for (let batchIndex = 0; batchIndex < batchSize; batchIndex++) {
          RunGuard.assertActive();
          let query;
          if (RewardsAuto.apiConfig.mode === "online") {
            query = await SearchService.getHotSearchWord();
          } else {
            query = RewardsAuto.searchPool[Utils.randomRange(0, RewardsAuto.searchPool.length - 1)];
          }

          searchCount++;
          Notice.log("🔍", `[PC] 搜索 ${searchCount}/${searchTotal}: ${query}`);

          try {
            const html = await SearchService.getSearchPage(query, false);
            if (html) await SearchService.reportSearch(query, false);
          } catch (e) {
            if (RunGuard.isStopError(e)) throw e;
            Notice.log("🟡", `搜索失败: ${e.message}`);
          }

          const wait = Utils.randomRange(5000, 30000);
          Notice.log("⏳", `等待 ${wait/1000}秒`);
          await Wait.delay(wait);
        }

        info = await RewardsQuery.getSearchQuota();
        RunGuard.assertActive();
        if (!SearchQuota.hasProgress(info)) {
          Notice.log("🟡", "搜索后无法确认服务器配额，暂停本轮搜索（保留未完成状态）");
          return TaskResult.create("unknown", "search_verification_unavailable");
        }
        Notice.log("📊", `搜索已核验 PC: ${info.pc.progress}/${info.pc.max}`);
        if (info.pc.progress >= info.pc.max) break;
        // 每批核验只记一次未增长，暂停时保留未完成状态。
        if (await SearchService.checkSearchRestricted(info)) return TaskResult.create("pending", "search_restricted");
      }

      if (info.pc.progress >= info.pc.max) {
        TaskState.searchDate = RunState.dateNowNum;
        TaskRecords.save(TaskState);
        SearchService.clearCompletedTracking();
        Notice.log(searchCount ? "🔍" : "✅", searchCount
          ? `搜索任务完成！PC: ${info.pc.progress}/${info.pc.max}`
          : `搜索配额已满 PC: ${info.pc.progress}/${info.pc.max}`, true);
      }
      return TaskResult.create("completed", "search_quota_verified");
    },

    // 每日活动：Bing 就地处理，后台转 Dashboard，Rewards 页直接点击。
    // 用户确认（2026-10-01）：Bing 完成卡片会隐藏，需到 rewards.bing.com 核验。
    // doStreak 查 /earn 的 dailyset 状态；页面分支仍保留 DOM 兼容判断。
    async doDailySet() {
      await WebSession.ensure();
      const today = Utils.getTodayNum();
      const completedKey = "Config.dailySetCompleted";
      if (Storage.get(completedKey, 0) === today) {
        Notice.log("✅", "每日活动今日已完成，跳过打开 dashboard");
        return TaskResult.create("completed", "dailyset_already_completed");
      }

      const processedKey = "Config.dailySetProcessed";
      // 点击记录按天去重，跨日清空。
      let processed = Storage.get(processedKey, []);
      if (processed.length > 0 && processed[0]?.date !== today) processed = [];
      const processedIds = new Set(processed.map(p => p.offerId));

      Notice.log("📅", `开始执行每日活动（已有 ${processedIds.size} 个点击尝试记录）...`);
      await Wait.randomDelay(3000, 8000);

      const currentHostname = typeof Platform.location === "undefined" ? "" : Platform.location.hostname;
      const hasDocumentBody = typeof Platform.document !== "undefined" && !!Platform.document.body;
      const isBingPage = /^(www|cn)\.bing\.com$/i.test(currentHostname);
      // 此变量表示缺少可用页面上下文，并非检测 Service Worker。
      const isServiceWorker = !hasDocumentBody || (currentHostname !== "rewards.bing.com" && !isBingPage);
      Notice.log("📅", `运行环境检测: ${isServiceWorker ? "service worker" : "页面上下文"} (hostname: ${currentHostname || "undefined"})`);

      if (isBingPage && hasDocumentBody) {
        const dailyLinks = ActivityPage.dailyLinks(false, true);
        const incompleteLinks = ActivityPage.dailyLinks(true, true);

        // Bing 有卡片且全部显示完成时，保存日期。
        if (dailyLinks.length > 0 && incompleteLinks.length === 0) {
          Storage.set(completedKey, today);
          Notice.log("✅", "Bing 奖励面板中的每日活动均已完成");
          return TaskResult.create("completed", "dailyset_verified");
        }

        if (incompleteLinks.length > 0) {
          Notice.log("📅", `Bing 页面发现 ${incompleteLinks.length} 个未完成的每日活动，尝试就地处理...`);
          try {
            const directProcessedIds = new Set(processedIds);
            const clickedCount = await ActivityPage.clickDailySetLinks(directProcessedIds);
            RunGuard.assertActive();
            const remainingLinks = ActivityPage.dailyLinks(true, true);
            // 兼容规则：点击后卡片消失即记完成，此处未复查官网。
            if (clickedCount > 0 && remainingLinks.length === 0) {
              Storage.set(completedKey, today);
              Notice.log("✅", `Bing 页面已确认每日活动完成（点击 ${clickedCount} 项）`, true);
              return TaskResult.create("completed", "dailyset_verified");
            }
            Notice.log("🟡", `Bing 页面未能确认每日活动完成（点击 ${clickedCount} 项，仍有 ${remainingLinks.length} 项未完成）`);
          } catch (e) {
            if (RunGuard.isStopError(e)) throw e;
            Notice.log("🟡", `Bing 页面处理每日活动失败: ${e.message}`);
          }
        } else {
          Notice.log("📅", "当前 Bing 页面未找到可识别的每日活动入口");
        }

        // 无法就地确认时请求 Dashboard，开页仅返回 pending。
        const dashboardRequest = await this._clickDailySetViaForeground();
        if (dashboardRequest?.opened) {
          Notice.log("📅", "已请求 Dashboard 检查每日活动", true);
        } else if (dashboardRequest?.active) {
          Notice.log("📅", "已有 Dashboard 处理请求，当前页面不重复打开");
        } else {
          Notice.log("🟡", "Bing 页面与 Dashboard 兜底均未能启动");
        }
        return dashboardRequest?.opened || dashboardRequest?.active
          ? TaskResult.create("pending", "dailyset_waiting_dashboard")
          : TaskResult.create("failed", "dailyset_dashboard_unavailable");
      }

      if (isServiceWorker) {
        Notice.log("📅", "后台模式：请求 Dashboard 处理每日活动...");
        const dashboardRequest = await this._clickDailySetViaForeground();
        if (dashboardRequest?.opened) {
          Notice.log("🔵", "已请求打开一个后台 dashboard，等待页面完成每日活动", true);
        } else if (dashboardRequest?.active) {
          Notice.log("📅", "已有 dashboard 处理请求，当前页面不重复打开");
        } else {
          Notice.log("🟡", "未能请求打开每日活动页面");
        }
        return dashboardRequest?.opened || dashboardRequest?.active
          ? TaskResult.create("pending", "dailyset_waiting_dashboard")
          : TaskResult.create("failed", "dailyset_dashboard_unavailable");
      } else {
        try {
          const clickedCount = await ActivityPage.clickDailySetLinks(processedIds);
          RunGuard.assertActive();
          // Rewards 页点击后仅保存尝试记录，返回 pending。
          if (clickedCount > 0) {
            const newProcessed = [...processedIds].map(id => ({ date: today, offerId: id }));
            Storage.set(processedKey, newProcessed);
            Notice.log("🔵", `每日活动完成，点击了 ${clickedCount} 个活动`, true);
            return TaskResult.create("pending", "dailyset_clicked");
          } else {
            Notice.log("🟡", "未找到可点击的每日活动链接");
            return TaskResult.create("unknown", "dailyset_links_unavailable");
          }
        } catch (e) {
          if (RunGuard.isStopError(e)) throw e;
          Notice.log("🔴", `每日活动执行异常: ${e.message}`);
          return TaskResult.create("failed", "dailyset_exception");
        }
      }
    },

    // 从 Dashboard 检测可领取积分，再开页领取。
    async doClaimPoints() {
      await WebSession.ensure();
      try {
        const dashboardHtml = await HttpClient.text({ url: "https://rewards.bing.com/dashboard" });
        if (!dashboardHtml) {
          Notice.log("🟡", "无法获取 dashboard 页面，领取状态待确认");
          return TaskResult.create("unknown", "claim_page_unavailable");
        }

        // 仅匹配中文“可领取”alt；未匹配按无需领取处理。
        const claimableMatch = dashboardHtml.match(/alt="可领取"[^>]*>[\s\S]*?(\d[\d,]*)/i);
        if (!claimableMatch) {
          Notice.log("📅", "未识别到可领取积分入口，按无需领取处理");
          return TaskResult.create("skipped", "nothing_claimable");
        }

        const amount = parseInt(claimableMatch[1].replace(/,/g, '')) || 0;
        if (amount > 0) {
          Notice.log("🎁", `发现 ${amount} 积分待领取，尝试自动领取...`);
          await this._claimPointsViaForeground();
          return TaskResult.create("pending", "claim_waiting_dashboard");
        } else {
          Notice.log("📅", "可领取积分为 0，跳过领取");
          return TaskResult.create("skipped", "nothing_claimable");
        }
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        Notice.log("🟡", `检测可领取积分失败: ${e.message}`);
        return TaskResult.create("unknown", "claim_check_failed");
      }
    },

    // 复用本轮 Dashboard 请求，开页不代表领取成功。
    async _claimPointsViaForeground() {
      if (isDashboardPage) {
        Notice.log("📅", "当前已在 dashboard 页面，跳过重复打开");
        return;
      }

      Notice.log("📅", "打开 dashboard 页面领取积分...");
      const opened = await DashboardTabs.openOnce();
      Notice.log("🎁", opened ? "已打开 dashboard 页面，等待领取结果确认..." : "已有 dashboard 处理请求，等待页面领取确认...");
    },

    // 查询连签；仅对启用且未完成的视觉搜索开页，再复查。
    async doStreak() {
      Notice.log("📅", "开始检测连签任务...");
      try {
        const earnHtml = await HttpClient.text({ url: "https://rewards.bing.com/earn" });
        if (!earnHtml) {
          Notice.log("🟡", "无法获取 earn 页面");
          return TaskResult.create("unknown", "streak_page_unavailable");
        }

        const { tasks, bonus } = DataParsers.parseStreakData(earnHtml);
        if (!tasks.length) {
          Notice.log("🟡", "未取得可识别的连签任务数据，跳过视觉搜索开页");
          return TaskResult.create("unknown", "streak_tasks_unavailable");
        }

        const taskMeta = {
          bing: { name: "必应搜索连续打卡" },
          dailyset: { name: "每日连续打卡活动" },
          bingapp: { name: "必应应用连续打卡" },
          visualsearch: { name: "视觉搜索连续打卡" }
        };
        const isDone = task => task.isCurrentDayCompleted === true ||
          (task.activitiesTotal > 0 && task.activitiesCompleted >= task.activitiesTotal);
        const enabledTasks = tasks.filter(task => task.isEnabled);
        const summarize = () => !enabledTasks.length
          ? TaskResult.create("skipped", "streak_tasks_disabled")
          : enabledTasks.every(isDone)
            ? TaskResult.create("completed", "streak_verified")
            : TaskResult.create("pending", "streak_incomplete");
        let result = summarize();

        for (const task of tasks) {
          if (!task.isEnabled) continue;
          const meta = taskMeta[task.partner] || { name: task.title || task.partner };
          const done = isDone(task);
          Notice.log(done ? "✅" : "📅",
            `${meta.name}: ${task.activitiesCompleted}/${task.activitiesTotal}${done ? " 已完成" : ""}`);
          if (task.partner === "dailyset" && Number.isFinite(task.completedDays)) {
            TaskState.streakDays = task.completedDays;
            Notice.log("📅", `每日连续打卡：${TaskState.streakDays} 天`);
          }

          // 官网 dailyset 完成后存日期，避免 Bing 卡片隐藏后重复开页。
          if (task.partner === "dailyset" &&
              task.isCurrentDayCompleted === true &&
              task.activitiesTotal > 0 &&
              task.activitiesCompleted >= task.activitiesTotal) {
            RunGuard.assertActive();
            Storage.set("Config.dailySetCompleted", Utils.getTodayNum());
          }
        }

        const visualSearch = tasks.find(task => task.partner === "visualsearch" && task.isEnabled);
        if (!visualSearch) {
          Notice.log("📅", "当前未下发视觉搜索连续打卡任务，跳过自动打开");
        } else if (!isDone(visualSearch)) {
          Notice.log("📅", "视觉搜索未完成，正在自动打卡...");
          // 先存当日尝试并核对归属；重复记录不开页，异常撤销本次记录。
          const attemptKey = "Config.visualSearchAttempt";
          const today = RunState.dateNowNum || Utils.getTodayNum();
          const previous = await Storage.get(attemptKey, null);
          if (Number(previous?.date) === today) {
            Notice.log("📅", "今日已尝试视觉搜索打卡，跳过重复打开");
            return TaskResult.create("pending", "visual_search_already_attempted");
          }

          const attempt = { date: today, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
          await Storage.set(attemptKey, attempt);
          const confirmed = await Storage.get(attemptKey, null);
          if (confirmed?.id !== attempt.id) {
            Notice.log("📅", "其他页面已处理视觉搜索打卡，跳过重复打开");
            return TaskResult.create("pending", "visual_search_other_page");
          }
          let opened = false;
          try {
            const vsUrl = "https://www.bing.com/?features=vsstreak,vstooltip&form=ML2XES";
            await WebSession.ensure();
            await Platform.openTab(vsUrl, { active: false, insert: true });
            opened = true;
            Notice.log("📅", "视觉搜索打卡页面已打开，完成状态待复查");
            await Wait.randomDelay(3000, 5000);
          } catch (e) {
            const latest = await Storage.get(attemptKey, null);
            if (latest?.id === attempt.id) await Storage.set(attemptKey, null);
            if (RunGuard.isStopError(e)) throw e;
            Notice.log("🟡", `视觉搜索打卡失败: ${e.message}`);
            result = TaskResult.create("failed", "visual_search_open_failed");
          }

          if (opened) {
            try {
              const refreshedHtml = await HttpClient.text({
                url: "https://rewards.bing.com/earn",
                headers: { "cache-control": "no-cache" }
              });
              const refreshed = DataParsers.parseStreakData(refreshedHtml).tasks
                .find(task => task.partner === "visualsearch" && task.isEnabled);
              if (refreshed) {
                Object.assign(visualSearch, refreshed);
                result = summarize();
              } else {
                result = TaskResult.create("unknown", "visual_search_verification_unavailable");
              }
              Notice.log(refreshed && isDone(refreshed) ? "✅" : "🟡",
                refreshed && isDone(refreshed)
                  ? "视觉搜索打卡已由服务端确认"
                  : "视觉搜索打卡尚未由服务端确认，今日不再重复打开");
            } catch (e) {
              if (RunGuard.isStopError(e)) throw e;
              Notice.log("🟡", `视觉搜索状态复查失败: ${e.message}`);
              result = TaskResult.create("unknown", "visual_search_verification_unavailable");
            }
          }
        }

        if (bonus) Notice.log("📅", `连签奖励印章进度: ${bonus.progress}/${bonus.total}`);

        Notice.log("📅", "连签任务检测完成");
        return result;
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        Notice.log("🔴", `连签任务异常: ${e.message}`);
        return TaskResult.create("unknown", "streak_check_failed");
      }
    },

    // 返回 Dashboard 是否新开页或已有请求。
    async _clickDailySetViaForeground() {
      try {
        const opened = await DashboardTabs.openOnce();
        Notice.log("📅", opened ? "已打开 dashboard 页面，等待自动点击每日活动..." : "已有 dashboard 处理请求，等待页面检查每日活动...");
        return { opened, active: DashboardTabs.requested };
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        Notice.log("🟡", `活动执行失败: ${e.message}`);
        return { opened: false, active: false };
      }
    }
  };

  // 任务调度：初始化、串行执行、汇总与释放锁。
  const TaskManager = {
    startTimer: null,

    // 加载本轮日期和任务记录，重置 PC 401 与阅读进度。
    init() {
      RunState.dateNowNum = Utils.getTodayNum();
      RunState.dateNowStr = Utils.getTodayStr();
      RunState.pc401 = false;
      ReadingState.progress = 0;
      ReadingState.max = 30;
      TaskRecords.load(TaskState);
      SearchService.restoreSearchTracking();
    },

    async withSession(action) {
      try {
        await WebSession.ensure();
        const result = await action();
        RunGuard.assertActive();
        return result;
      } catch (e) {
        if (!RunGuard.isStopError(e) && !SessionGuard.isStopped()) Notice.log("🔴", `任务执行异常: ${e.message}`);
      }
    },

    // 可重试结果或普通异常最多补试 2 次；中止信号直接抛出。
    async runTask(taskFn, taskName, retries = 0) {
      const retryDelay = 60000;
      const maxRetries = 2;
      try {
        await WebSession.ensure();
        const result = await taskFn();
        RunGuard.assertActive();
        if (!TaskResult.isValid(result)) return TaskResult.create("unknown", "invalid_task_result");
        const retryable = result.retryable && ["pending", "failed", "unknown"].includes(result.status);
        if (retryable && retries < maxRetries) {
          Notice.log("🟡", `${taskName} 未完成或待确认，${retryDelay/1000}秒后重试 (${retries + 1}/${maxRetries})`);
          await Wait.delay(retryDelay);
          return this.runTask(taskFn, taskName, retries + 1);
        }
        return TaskResult.create(result.status, result.reason);
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        if (SessionGuard.isStopped()) throw SessionGuard.error();
        if (retries < maxRetries) {
          Notice.log("🟡", `${taskName} 异常: ${e.message}，${retryDelay/1000}秒后重试`);
          await Wait.delay(retryDelay);
          return this.runTask(taskFn, taskName, retries + 1);
        }
        Notice.log("🔴", `${taskName} 失败: ${e.message}`);
        return TaskResult.create("failed", "task_exception");
      }
    },

    // 主流程：取锁 → 准备 → 执行任务 → 二次扫描 → 汇总 → 释放锁。
    async runAll({ force = false } = {}) {
      if (this.running) {
        Notice.log("🟡", "任务正在运行中，请勿重复触发");
        return;
      }
      Startup.cancelRetry();
      this.running = true;
      // 自动启动复用已查地区和锁；手动运行取消倒计时。
      let regionChecked = this.startTimer !== null && LockState.held;
      if (this.startTimer !== null) {
        clearTimeout(this.startTimer);
        this.startTimer = null;
      }
      let hasRunLock = LockState.held;
      try {
      if (force && hasRunLock) {
        // 手动接管遇失效租约时，先清理再重新取锁。
        try { RunGuard.assertLock(); } catch (e) {
          if (e.code !== "TASK_RUN_LOCK_LOST") throw e;
          await TaskRunLock.release();
          hasRunLock = regionChecked = false;
        }
      }
      await WebSession.ensure();
      if (!hasRunLock) hasRunLock = await TaskRunLock.acquire({ force });
      if (!hasRunLock) {
        Notice.log("🟡", "其他页面正在运行或准备任务，跳过重复启动");
        return;
      }
      // 强制运行跳过本轮及其 Dashboard 的地区检查。
      if (force) {
        Notice.log("🚀", "手动强制运行，已取得本页运行权");
        Notice.log("🔓", "手动强制运行：本次跳过地区检查");
      } else if (!regionChecked && !await RegionService.checkRegion()) return;
      RunGuard.assertActive();
      RunState.forceRun = force === true;

      // 初始化本轮状态，并启用跨日检查。
      UserInfoSession.beginRun();
      RunState.startTime = Date.now();
      Notice.log("🚀", "启动全能自动化任务...");
      this.init();
      RunDateGuard.begin(RunState.dateNowNum);
      DashboardTabs.requested = false;
      TaskState.cardAttempted.clear();
      TaskState.cardResults.clear();
      CardService.beginCardRun();

      // App Token 失败时仍尝试 PC 签到。
      const isTokenOK = await AppTokenSession.renewToken();
      if (!isTokenOK) {
        Notice.log("🟡", "App Token 未就绪，仍尝试 PC 签到，跳过阅读", true);
      }

      // 检查网页会话后记录初始余额，必要时使用其他数据源。
      await RewardsWebSession.ensure(UserInfoSession.recoveryTimeout);

      const startBalance = DataParsers.accountBalance(await RewardsQuery.getBalance());
      Notice.log("📊", `初始积分: ${startBalance ?? "未确认"}`);

      // 签到均尝试；阅读须有 Token 且 PC 未报 401。
      await this.runTask(() => TaskActions.doSign(), "签到");
      await Wait.randomDelay();
      if (isTokenOK) {
        if (!RunState.pc401) {
          await this.runTask(() => TaskActions.doRead(), "阅读");
          await Wait.randomDelay();
        } else {
          Notice.log("🟡", "PC会话已过期，跳过阅读任务");
        }
      }

      // 按顺序执行任务，由任务结果决定重试。
      await this.runTask(() => TaskActions.doPromos(), "活动卡片");
      await Wait.randomDelay();

      await this.runTask(() => TaskActions.doSearch(), "搜索");

      await this.runTask(() => TaskActions.doStreak(), "连签检测");
      await Wait.randomDelay();

      Notice.log("📅", "开始执行每日活动任务...");
      await Wait.randomDelay();
      await this.runTask(() => TaskActions.doDailySet(), "每日活动");

      try {
        // 领取开页和二次扫描不自动重试，避免重复动作。
        await TaskActions.doClaimPoints();
      } catch (e) {
        if (RunGuard.isStopError(e)) throw e;
        Notice.log("🟡", `领取积分执行异常: ${e.message}`);
      }

      if (Storage.get("Tasks.promos", true)) {
        await Wait.randomDelay(3000, 8000);
        await TaskActions.doPromos(true);
      }

      // 耗时截止到最终查询前；积分增量取前后有效余额。
      const endTime = Date.now();
      const totalTime = ((endTime - RunState.startTime) / 1000).toFixed(1);

      // 最终查询后再查登录，旧会话不发布汇总。
      const endBalance = DataParsers.accountBalance(await RewardsQuery.getBalance());

      const info = await RewardsQuery.getRewardsInfo();
      await WebSession.ensure();
      if (info) {
        const logMsg = RunSummary.format({
          info, startBalance, endBalance, today: RunState.dateNowNum,
          tasks: {
            signDate: TaskState.signDate, readDate: TaskState.readDate,
            promosDate: TaskState.promosDate, streakDays: TaskState.streakDays
          },
          read: { progress: ReadingState.progress, max: ReadingState.max },
          promosEnabled: Storage.get("Tasks.promos", true)
        });

        Notice.log("📊", logMsg, true);
      } else {
        Notice.log("🎉", `任务执行完成！用时 ${totalTime} 秒`, true);
      }
      } catch (e) {
        if (e.code === "TASK_RUN_DATE_CHANGED") Notice.log("🟡", e.message);
        else if (!RunGuard.isStopError(e) && !SessionGuard.isStopped()) Notice.log("🔴", `任务执行异常: ${e.message}`);
      } finally {
        // 始终尝试释放锁，清除日期检查和 running 状态。
        try {
          if (hasRunLock) await TaskRunLock.release();
        } catch (e) {
          Platform.log("🟡 运行锁释放失败，将在过期后自动恢复: " + e.message);
        } finally {
          RunDateGuard.end();
          RunState.forceRun = false;
          this.running = false;
        }
      }
    }
  };

  // 页面入口：普通 Rewards 页、Dashboard、菜单与主任务。

  const RewardsPageEntry = {
    start() {
      const startPunchCards = () => {
        // 页面就绪 3 秒后，经登录和地区检查再点击。
        setTimeout(() => TaskManager.withSession(async () => {
          if (!await RegionService.checkRegion()) return;
          const path = Platform.location.pathname;
          if (path.includes("/earn/quest/") || path.includes("punchcard")) {
            console.log("[Rewards Auto] 检测到打卡详情页，开始执行任务点击...");
            await ActivityPage.clickDetailTasks();
          } else {
            console.log("[Rewards Auto] 检测到奖励主页，开始执行卡片点击...");
            await ActivityPage.clickPunchCards();
          }

          console.log("[Rewards Auto] 开始执行每日活动点击...");
          await TaskActions.doDailySet();

          console.log("[Rewards Auto] 检查可领取积分...");
          await TaskActions.doClaimPoints();
        }), 3000);
      };

      if (Platform.document.readyState === "complete" || Platform.document.readyState === "interactive") {
        startPunchCards();
      } else {
        Platform.document.addEventListener("DOMContentLoaded", startPunchCards);
      }
    }
  };

  const DashboardPageEntry = {
    start() {
      Notice.log("📅", "前台模式：统一处理 dashboard 任务...");

      const dashboardTabKey = "RewardsAuto.dashboardTab";
      // 从 hash 读取自动开页 ID，暂存以便刷新后识别。
      const dashboardLockId = (() => {
        const match = String(Platform.location.hash || "").match(/(?:^#|&)rauto=([^&]+)/);
        let lockId = "";
        if (match) {
          try { lockId = decodeURIComponent(match[1]); } catch (_) { lockId = match[1]; }
        }
        try {
          if (lockId) {
            Platform.sessionStorage.setItem(dashboardTabKey, JSON.stringify({
              id: lockId, expiresAt: Date.now() + DashboardTabs.ttl
            }));
          } else {
            const saved = JSON.parse(Platform.sessionStorage.getItem(dashboardTabKey) || "null");
            if (typeof saved?.id === "string" && saved.id && Number(saved.expiresAt) > Date.now()) return saved.id;
            Platform.sessionStorage.removeItem(dashboardTabKey);
          }
        } catch (_) {}
        return lockId;
      })();

      // 仅更新本页租约，完成后保留 1 分钟开页冷却。
      const releaseDashboardLock = async () => {
        if (!dashboardLockId) return;
        const lock = await Storage.get(DashboardTabs.key, null);
        if (lock?.id !== dashboardLockId) return;
        const now = Date.now();
        await Storage.set(DashboardTabs.key, {
          ...lock,
          completedAt: now,
          expiresAt: now + DashboardTabs.cooldown
        });
      };

      // 仅关闭带自动开页标记的 Dashboard。
      const closeDashboardPage = () => {
        if (!dashboardLockId) {
          Notice.log("📄", "当前 dashboard 是手动打开的，保留页面，不自动关闭");
          return;
        }

        Notice.log("📄", "Dashboard 页面处理流程结束，准备关闭自动打开的页面...");
        releaseDashboardLock().catch(() => {});
        setTimeout(() => {
          try { Platform.sessionStorage.removeItem(dashboardTabKey); } catch (_) {}
          const targets = [];
          try { if (typeof Platform.unsafeWindow !== "undefined") targets.push(Platform.unsafeWindow); } catch (_) {}
          try { if (typeof Platform.window !== "undefined" && !targets.includes(Platform.window)) targets.push(Platform.window); } catch (_) {}
          for (const target of targets) {
            try {
              if (typeof target.close === "function") target.close();
            } catch (_) {}
          }
        }, 1500);
      };

      // 识别领取卡片后，用页面 fetch 调用领取 Action。
      const autoClaimPoints = async () => {
        await WebSession.ensure();
        // 领取 Action 与路由树写死，此处不使用卡片的动态 Action。
        const CLAIM_ACTION = "00491296f1d668ad46b65342c95cb9d72a62c1fa9d";
        const ROUTER_STATE = "%5B%22%22%2C%7B%22children%22%3A%5B%22(nav)%22%2C%7B%22children%22%3A%5B%22dashboard%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%2C4096%5D%7D%2Cnull%2Cnull%2C4096%5D%7D%2Cnull%2Cnull%2C4096%5D%7D%2Cnull%2Cnull%2C4112%5D";
        const wait = ms => Wait.delay(ms);
        const normalize = text => String(text || "").normalize("NFKC").replace(/\s+/g, " ").trim();
        const findClaimCard = () => Array.from(Platform.document.querySelectorAll('button, [role="button"], a[href]'))
          .map(control => ({ control, text: normalize(control.innerText || control.textContent || control.getAttribute("aria-label")) }))
          .find(({ text }) => /可领取|可領取|待领取|待領取|claimable|points? to claim/i.test(text)
            && !/可用积分|可用積分|兑换|兌換|available points?|redeem/i.test(text));

        try {
          let card = null;
          for (let i = 0; i < 40 && !card; i++) {
            card = findClaimCard();
            if (!card) await wait(500);
          }
          await WebSession.ensure();
          // 等待后无卡片按无需领取处理，未另查页面结构。
          if (!card) {
            Notice.log("📅", "等待后仍未找到可领取积分卡片，按无需领取处理");
            return { claimed: false, amount: 0, status: "none" };
          }

          const amountText = String(card.text || "");
          const amountMatch = amountText.match(/(\d[\d,\s]*)/);
          const amount = amountMatch
            ? parseInt(amountMatch[1].replace(/[\s,]/g, ""), 10) || 0
            : 0;
          if (amount <= 0) {
            Notice.log("📅", "未解析出正数可领取积分，本次不提交领取");
            return { claimed: false, amount: 0, status: "none" };
          }

          Notice.log("🎁", `发现 ${amount} 积分待领取，调用领取接口...`);
          const pageWindow = typeof Platform.unsafeWindow !== "undefined" ? Platform.unsafeWindow : Platform.window;
          const { response, responseText } = await HttpClient.fetchText(pageWindow, "https://rewards.bing.com/dashboard", {
            method: "POST",
            credentials: "include",
            redirect: "follow",
            headers: {
              "accept": "text/x-component",
              "content-type": "text/plain;charset=UTF-8",
              "next-action": CLAIM_ACTION,
              "next-router-state-tree": ROUTER_STATE
            },
            body: "[]"
          });
          if (!response.ok) {
            Notice.log("🟡", `领取接口返回 HTTP ${response.status}，Next-Action 可能已更新`);
            return { claimed: false, amount, status: "failed" };
          }
          // HTTP 成功且响应明确成功，才确认领取。
          if (ActivityService.activityResponseResult(responseText, true) !== true) {
            Notice.log("🟡", `领取接口未返回成功标记: ${responseText.slice(0, 160)}`);
            return { claimed: false, amount, status: "failed" };
          }
          Notice.log("🎁", `${amount} 积分领取成功（服务端已确认）！`);
          return { claimed: true, amount, status: "claimed" };
        } catch (e) {
          Notice.log("🟡", `自动领取积分失败: ${e.message}`);
          return { claimed: false, amount: 0, status: "failed" };
        }
      };

      // 页面启动 5 秒后，依次处理每日活动和领取。
      setTimeout(() => TaskManager.withSession(async () => {
        // 自动打开的 Dashboard 继承本轮强制运行标记。
        const request = dashboardLockId ? await Storage.get(DashboardTabs.key, null) : null;
        RunGuard.assertActive();
        const force = request?.id === dashboardLockId && request.force === true &&
          request.sessionResetId === SessionGuard.resetId && Number(request.expiresAt) > Date.now() && !request.completedAt;
        if (force) Notice.log("🔓", "本次强制运行：Dashboard 跳过地区检查");
        else if (!await RegionService.checkRegion()) return;
        Notice.log("📅", "页面加载完成，开始自动处理...");
        const dailyResult = await ActivityPage.clickDashboardDailySet();
        await WebSession.ensure();
        // 保存 Dashboard 的 DOM 完成日期，供主任务跳过。
        if (dailyResult?.completed === true) {
          Storage.set("Config.dailySetCompleted", Utils.getTodayNum());
        }

        const claimResult = await autoClaimPoints();
        await WebSession.ensure();
        const claimDone = claimResult?.claimed === true || claimResult?.status === "none";
        // 每日活动判为完成，且领取成功或无需领取时才关页。
        if (dailyResult?.completed === true && claimDone) {
          closeDashboardPage();
        } else {
          const dailyState = dailyResult?.completed === true ? "页面未检测到未完成项" : "待确认";
          const claimState = claimResult?.claimed === true
            ? "已领取"
            : claimResult?.status === "none" ? "按无需领取处理" : "失败";
          Notice.log("🟡", `dashboard 暂不关闭：每日活动${dailyState}，积分${claimState}`);
        }
      }), 5000);

      return;
    }
  };

  const MenuController = {
    register() {
      Platform.registerMenu("🔑 手动授权", () => {
        Platform.openTab("https://login.live.com/oauth20_authorize.srf?client_id=0000000040170455&response_type=code&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL&redirect_uri=https://login.live.com/oauth20_desktop.srf", { active: true });
      });

      Platform.registerMenu("📋 粘贴授权码", () => {
        const code = Platform.prompt("粘贴授权页面跳转后的完整URL:");
        if (code?.trim()) {
          Storage.set("Config.code", code.trim());
          Platform.alert("已保存！");
        }
      });

      Platform.registerMenu("📊 Token状态", () => {
        const token = Storage.get("Config.token", false);
        const time = Storage.get("Config.tokenTime", 0);
        let ageStr = "未知";
        if (time > 0) {
          const diff = Date.now() - time;
          const days = Math.floor(diff / 86400000);
          const hours = Math.floor((diff % 86400000) / 3600000);
          const minutes = Math.floor((diff % 3600000) / 60000);
          const parts = [];
          if (days > 0) parts.push(`${days}天`);
          if (hours > 0) parts.push(`${hours}小时`);
          parts.push(`${minutes}分钟`);
          ageStr = parts.join("");
        }
        const tokenDate = time > 0 ? new Date(time).toLocaleString("zh-CN") : "未知";
        Platform.alert(`Token: ${token ? "已保存" : "无"}\n获取时间: ${tokenDate}\n已过: ${ageStr}\n授权码: ${Storage.get("Config.code", "") ? "有" : "无"}`);
      });

      Platform.registerMenu("🚀 立即运行", () => TaskManager.runAll({ force: true }));

      Platform.registerMenu("🔔 配置通知接口", () => {

        let configStr = "🔔 通知接口配置\n";
        configStr += "==================\n\n";
        Webhooks.forEach((item, index) => {
          const saved = Storage.get(item.storageKey, "");
          configStr += `${index + 1}. ${item.configName}\n`;
          configStr += `   状态: ${saved ? "✅ 已配置" : "❌ 未配置"}\n`;
          configStr += `   说明: ${item.hint}\n\n`;
        });
        configStr += "请输入要配置的编号 (1-5)，或输入 0 清除所有配置：";

        const choice = Platform.prompt(configStr);
        if (!choice) return;

        const num = parseInt(choice);
        if (num === 0) {
          if (Platform.confirm("确定要清除所有通知接口配置吗？")) {
            Webhooks.forEach(item => Storage.set(item.storageKey, ""));
            Platform.alert("所有通知接口配置已清除！");
          }
          return;
        }

        if (num >= 1 && num <= 5) {
          const selected = Webhooks[num - 1];
          const current = Storage.get(selected.storageKey, "");
          const newValue = Platform.prompt(`配置 ${selected.configName}\n\n当前值: ${current || "(空)"}\n\n请输入新的值：`, current);
          if (newValue !== null) {
            Storage.set(selected.storageKey, newValue.trim());
            Platform.alert(`${selected.configName} 已${newValue.trim() ? "配置" : "清除"}！`);
          }
        } else {
          Platform.alert("无效的编号！");
        }
      });

      Platform.registerMenu("📢 测试通知", () => {
        Notice.log("📢", "测试通知已发送", true);
        Platform.alert("测试消息已发送，请检查各通知渠道！");
      });

      // 浏览器通知开关独立于外部推送配置。
      const updateBroMenu = () => {
        const enabled = Storage.get("Notice.bro", true);
        return enabled ? "🔕 关闭浏览器通知" : "🔔 开启浏览器通知";
      };
      Platform.registerMenu(updateBroMenu(), () => {
        const current = Storage.get("Notice.bro", true);
        Storage.set("Notice.bro", !current);
        Platform.alert(`浏览器通知已${!current ? "开启" : "关闭"}`);
        Platform.location.reload();
      });

      Platform.registerMenu("📋 查看通知状态", () => {
        let status = "📊 通知接口配置状态：\n\n";
        for (const channel of Webhooks) {
          status += channel.name + ": " + (Storage.get(channel.storageKey, "") ? "✅ 已配置" : "❌ 未配置") + "\n";
        }
        Platform.alert(status);
      });
    }
  };

  const Startup = {
    retryTimer: null,
    cancelRetry() {
      if (this.retryTimer !== null) clearTimeout(this.retryTimer);
      this.retryTimer = null;
    },
    start: (retrying = false) => TaskManager.withSession(async () => {
      if (TaskManager.running || TaskManager.startTimer !== null || Startup.retryTimer !== null || LockState.pageLeaving) return;
      TaskManager.init();

      const isKeep = Storage.get("Config.keep", true);
      const checkDone = (enabled, date) => !enabled || date === RunState.dateNowNum;
      // 仅检查已启用的签到、阅读、卡片和搜索完成日期。
      const isAllDone = checkDone(Storage.get("Tasks.sign", true), TaskState.signDate) &&
               checkDone(Storage.get("Tasks.read", true), TaskState.readDate) &&
               checkDone(Storage.get("Tasks.promos", true), TaskState.promosDate) &&
               checkDone(Storage.get("Tasks.search", true), TaskState.searchDate);

      if (!isKeep && isAllDone) {
        Notice.log("💤", "已启用的签到、阅读、活动卡片和搜索均有今日完成记录，停止本轮检测");
        return;
      }

      // 先取锁再倒计时，避免多页重复启动。
      if (!await TaskRunLock.acquire()) {
        // 等待锁释放时只保留一个重试定时器。
        if (!TaskManager.running && TaskManager.startTimer === null && !LockState.pageLeaving &&
            !SessionGuard.isStopped() && Startup.retryTimer === null) {
          if (!retrying) Notice.log("🟡", "其他页面正在运行或准备任务，等待释放后自动重试");
          Startup.retryTimer = setTimeout(() => {
            Startup.retryTimer = null;
            if (!LockState.pageLeaving && !SessionGuard.isStopped()) return Startup.start(true);
          }, LockState.heartbeatMs);
        }
        return;
      }
      Startup.cancelRetry();

      const startupLockKey = LockState.key;
      try {
        // 地区失败即退出；手动接管后不再安排自动启动。
        if (!await RegionService.checkRegion()) return;
        RunGuard.assertActive();
        if (TaskManager.running || LockState.key !== startupLockKey) return;

        // 随机延迟 5～60 秒启动。
        const delay = Utils.randomRange(5000, 60000);
        Notice.log("⏳", `${delay/1000}秒后启动...`);
        TaskManager.startTimer = setTimeout(() => TaskManager.runAll(), delay);
      } finally {
        // 未安排倒计时且未被手动接管时，释放准备阶段的锁。
        if (TaskManager.startTimer === null && !TaskManager.running && LockState.key === startupLockKey) {
          await TaskRunLock.release();
        }
      }
    })
  };

  // 入口：监听退出，启动页面任务、菜单及主流程。
  const AppEntry = {
    start() {
      if (typeof Platform.document !== "undefined") Platform.document.addEventListener("click", event => {
        const control = event.target?.closest?.('a, button, [role="button"], [role="menuitem"]');
        if (!control) return;
        const label = String(control.getAttribute("aria-label") || control.textContent || "").trim();
        let logoutLink = false;
        try {
          const url = new URL(control.getAttribute("href"), Platform.location.href);
          logoutLink = ["login.live.com", "account.live.com", "rewards.bing.com", "www.bing.com", "cn.bing.com", "bing.com"].includes(url.hostname)
            && /\/(?:signout|logout)(?:[/.]|$)/i.test(url.pathname);
        } catch (_) {}
        const accountMenu = control.closest?.('#id_d, #id_l, #mectrl_main, [id^="mectrl_"]');
        if (logoutLink || /^(?:退出登录|退出登入|退出登錄|登出|注销|註銷|sign\s*out|log\s*out)$/i.test(label)
          || accountMenu && label === "退出") {
          SessionGuard.stop("已手动退出网页登录", true);
        }
      }, true);
      const isRedeemPage = Platform.location.hostname === "rewards.bing.com" && Platform.location.pathname.startsWith("/redeem");
      if (Platform.location.hostname === "rewards.bing.com" && !isRedeemPage && !isDashboardPage) RewardsPageEntry.start();
      if (isRedeemPage) return;
      MenuController.register();
      Platform.cookie("delete", { url: "https://bing.com", name: "_EDGE_S" });
      if (isDashboardPage) { DashboardPageEntry.start(); return; }
      Startup.start();
    }
  };

  AppEntry.start();

})();
