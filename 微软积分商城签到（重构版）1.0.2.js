// ==UserScript==
// @name         微软积分商城签到（重构版）
// @version      1.0.2
// @description  每天在后台自动完成 Microsoft Rewards 任务获取积分奖励，✅签入(PC+App静默)、✅阅读、✅活动、✅搜索、✅Quiz、✅拼图、✅热搜API、✅二次扫描、✅积分通知、✅连签任务检测、✅每日活动自动上报
// @author       kunkun
// @icon         https://rewards.bing.com/rewardscdn/images/rewards/rewards-icon-96.png
// @homepage     https://scriptcat.org/zh-CN/script-show-page/7869
// @updateURL    https://scriptcat.org/scripts/code/7869/微软积分商城签到（重构版）.user.js
// @downloadURL  https://scriptcat.org/scripts/code/7869/微软积分商城签到（重构版）.user.js
// @license      MIT
// @crontab      */20 * * * *
// @connect      bing.com
// @connect      login.live.com
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
// @grant        GM_cookie
// @grant        GM_info
// @grant        GM_log
// @grant        GM_registerMenuCommand
// @storageName  BingRewardsAuto_Shared
// @tips         此脚本为开源免费使用，请勿购买
// ==/UserScript==

/* global GM_cookie, GM_getValue, GM_setValue, GM_xmlhttpRequest, GM_log, GM_info, GM_notification, GM_openInTab */

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
    span:
        title: 搜索间隔（秒）
        type: number
        default: 30
        min: 30
        unit: ±15秒
    api:
        title: 搜索词接口（offline为随机搜索词）
        type: select
        default: offline
        values: [offline, hot.nntool.cc, hot.baiwumm.com, hot.cnxiaobai.com]
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
        title: Quiz 自动答题
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

(function() {
    'use strict';

    if (location.hostname === "rewards.bing.com" &&
        /^\/(?:api\/getuserinfo|signin|signin-oidc|createuser)\/?$/i.test(location.pathname)) return;

    // 授权码自动捕获
    if (location.hostname === "login.live.com" && location.pathname === "/oauth20_desktop.srf") {
        const code = new URLSearchParams(location.search).get("code");
        if (code) {
            GM_setValue("Config.code", location.href);
            GM_setValue("Config.token", false);
            if (GM_getValue("Notice.bro", true)) {
                try { GM_notification({ title: "🟢 授权成功", text: "授权码已捕获，可关闭此页" }); } catch(_) {}
            }
            try { history.replaceState({}, "", "about:blank"); } catch(_) {}
            setTimeout(() => { try { window.close(); } catch(_) {} }, 200);
        }
        return;
    }

    // 视觉搜索活动页也匹配本脚本，禁止它再次启动整套任务形成开页循环。
    const bingFeatures = new URLSearchParams(location.search).get("features")
        ?.split(",").map(item => item.trim().toLowerCase()) || [];
    if (/^(?:www\.|cn\.)?bing\.com$/i.test(location.hostname) && bingFeatures.includes("vsstreak")) return;

    const RewardsAuto = {
        // 锁定国区代码总开关：true 默认开启；false 强制关闭，不受管理器旧值影响。
        // 总开关关闭时，地区检查和请求中的国区参数都会被取消。
        lockRegion: true,

        // UA: pc=Edge桌面, mobile=Edge移动, app=BingSapphire真机抓包
        ua: {
            pc: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
            mobile: "Mozilla/5.0 (Linux; Android 16; Redmi K20 Pro Build/BP4A.251205.006; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Mobile Safari/537.36 EdgA/131.0.0.0",
            // App 端 UA（来自真实抓包数据，Redmi K20 Pro + BingSapphire）
            app: "Mozilla/5.0 (Linux; Android 16; Redmi K20 Pro Build/BP4A.251205.006; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Mobile Safari/537.36 BingSapphire/32.6.2110003560",
        },
        appConfig: {
            rewardsAppId: "SAAndroid/32.6.2110003560",
            channel: "SAAndroid",                       // 渠道：Android 版 Bing App
            offerIds: {
                dailyCheckIn: "Gamification_Sapphire_DailyCheckIn",  // 每日签到标识
                readArticle: "ENUS_readarticle3_30points",           // 阅读任务标识
            }
        },
        searchPool: [
            "what is the weather forecast tomorrow",
            "how do I make sourdough bread at home",
            "where can I find cheap flights to tokyo",
            "why is the sky blue scientific explanation",
            "how to learn rust programming in 2026",
            "what time does the world cup final start",
            "how to fix a leaky kitchen faucet step by step",
            "what are the best vr games of 2026",
            "how to start a vegetable garden in spring",
            "where to watch new movies this week",
            "how to take care of a bonsai tree",
            "what is the difference between python async and threading",
            "how to meditate properly for beginners",
            "what is the origin of halloween traditions",
            "how do solar panels actually work",
            "what is the best mechanical keyboard for typing",
            "how to tie a windsor knot tie",
            "what causes northern lights aurora borealis",
            "how to brew the perfect espresso at home",
            "what are the symptoms of vitamin d deficiency",
            "how to sleep better naturally tonight",
            "why do cats purr when they are happy",
            // 地点/新闻/购物意图
            "best coffee shops in san francisco downtown",
            "italian restaurants near times square",
            "tokyo cherry blossom season 2026 forecast",
            "rtx 5070 ti benchmark vs rtx 4080 super",
            "iphone 17 release date and features",
            "tesla stock price today nasdaq",
            "best noise cancelling headphones under 300",
            "fastest electric cars 0 to 60 mph",
            "vintage camera brands collectors guide",
            "budget gaming laptop with rtx 4070 2026",
            // 操作指南/食谱
            "easy chocolate chip cookies recipe from scratch",
            "30 minute home workout routine no equipment",
            "stretching exercises for lower back pain relief",
            "easy origami crane folding instructions",
            "git rebase vs merge which one to use",
            "markdown cheat sheet with examples",
            "japanese hiragana chart pronunciation",
            "ancient rome history quick overview",
            "pomodoro technique for focus and productivity",
            "healthy breakfast ideas under 10 minutes",
            // 中文搜索词
            "天气预报", "今日新闻热点", "美食食谱家常菜", "旅游攻略", "健康养生知识",
            "科技资讯", "电影推荐", "股票行情", "体育赛事", "历史上的今天"
        ],
        // 热搜API配置
        apiConfig: {
            mode: GM_getValue("Config.api", "offline"),
            arr: [
                ["hot.baiwumm.com", {
                    url: "https://hot.baiwumm.com/api/",
                    hot: ["weibo", "douyin", "baidu", "toutiao", "thepaper", "qq", "netease", "zhihu"],
                }],
                ["hot.cnxiaobai.com", {
                    url: "https://cnxiaobai.com/DailyHotApi/",
                    hot: ["weibo", "douyin", "baidu", "toutiao", "thepaper", "qq-news", "netease-news", "zhihu"],
                }],
                ["hot.nntool.cc", {
                    url: "https://hotapi.nntool.cc/",
                    hot: ["weibo", "douyin", "baidu", "toutiao", "thepaper", "qq-news", "netease-news", "zhihu"],
                }],
            ],
            url: "",
            hot: [],
            wordList: [],
            wordIndex: 0,
        },
        skipPatterns: [
            "referral", "refer and earn", "sweepstake", "entries",
            "install the", "set bing as your default", "bing wallpaper",
            "punch card", "ancient coin", "sea of thieves", "rewards extension",
            "redemption goal", "order history", "claim your gift", "shop to earn",
            "set goal", "Available tomorrow", "Offer is Locked", "Earn -1 points"
        ],
        skipHrefs: [
            "sweepstakes/", "referandearn", "aka.ms/win", "workinprogress",
            "punchcard", "microsoft-store", "goal/all", "orderhistory",
            "/redeem", "/redeemgoal", "xbox.com/rewards"
        ],
        state: {
            token: false,
            region: "CN",
            host: "www.bing.com",
            dateNowNum: 0,
            dateNowStr: "",
            pcProgress: 0,
            pcMax: 90,
            readProgress: 0,
            readMax: 30,
            sendMSG: "",
            lastSearchProgress: -1,
            restrictedTimes: 0,
            ip: "",
            ipInfo: "",
            startTime: 0,
        }
    };

    const Webhooks = [
        {
            name: "企业微信",
            url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=",
            key: GM_getValue("Notice.wework", false),
            msg: {
                "msgtype": "text",
                "text": {
                    get content() {
                        return `> ${new Date().toLocaleString()}\n\n ## ${GM_info.script.name}\n ${RewardsAuto.state.sendMSG}`
                    }
                },
            },
        },
        {
            name: "钉钉",
            url: "https://oapi.dingtalk.com/robot/send?access_token=",
            key: GM_getValue("Notice.dingding", false),
            msg: {
                "msgtype": "markdown",
                "markdown": {
                    "title": GM_info.script.name,
                    get text() {
                        return `> ${new Date().toLocaleString()}\n ### ${GM_info.script.name}\n ${RewardsAuto.state.sendMSG}`
                    }
                },
            },
        },
        {
            name: "飞书",
            url: "https://open.feishu.cn/open-apis/bot/v2/hook/",
            key: GM_getValue("Notice.feishu", false),
            msg: {
                "msg_type": "interactive",
                "card": {
                    "schema": "2.0",
                    "header": {
                        "title": {
                            "tag": "plain_text",
                            "content": GM_info.script.name
                        },
                        "template": "orange"
                    },
                    "body": {
                        "elements": [{
                            "tag": "markdown",
                            "text_align": "center",
                            get content() {
                                return `#### ${new Date().toLocaleString()}\n ${RewardsAuto.state.sendMSG}`
                            }
                        }]
                    }
                }
            },
        },
        {
            name: "PushMe",
            url: "https://push.i-i.me/?push_key=",
            key: GM_getValue("Notice.pushme", false),
            msg: {
                "type": "markdown",
                "title": `${GM_info.script.name}[#rewards!https://rewards.bing.com/rewards.png]`,
                get content() {
                    return `\n ${RewardsAuto.state.sendMSG}`
                }
            },
        },
        {
            name: "Bark",
            url: "https://api.day.app/",
            key: GM_getValue("Notice.bark", false),
            msg: {
                "group": "rewards",
                "icon": "https://rewards.bing.com/rewards.png",
                "title": GM_info.script.name,
                get markdown() {
                    return `\n ${RewardsAuto.state.sendMSG}`
                }
            },
        },
    ];

    // 以 Bing 的网页登录为前提；Rewards 旧接口的 401 不能代表 Bing 已退出。
    const WebSession = {
        stopped: false,
        checking: null,
        verified: false,
        logoutCleared: false,
        resetId: GM_getValue("Config.sessionResetId", ""),

        error() {
            return Object.assign(new Error("网页登录检查未通过，任务已停止"), { code: "WEB_SESSION_STOPPED" });
        },

        isStopped() {
            if (!this.stopped && GM_getValue("Config.sessionResetId", "") !== this.resetId) {
                this.stop("其他页面已退出登录");
            }
            return this.stopped;
        },

        assertActive() {
            if (this.isStopped()) throw this.error();
        },

        stop(reason, confirmedLogout = false) {
            const firstStop = !this.stopped;
            const firstLogout = confirmedLogout && !this.logoutCleared;
            if (firstStop || firstLogout) {
                this.stopped = true;
                RewardsAuto.state.token = false;
                RewardsAuto.state.sendMSG = "";
                RewardsAuto.state.pcProgress = 0;
                RewardsAuto.state.readProgress = 0;
                if (firstLogout) {
                    this.logoutCleared = true;
                    // 仅确认退出时清除授权和账号任务记录，网络故障只暂停本轮。
                    const cleared = {
                        "Config.token": false, "Config.tokenTime": 0, "Config.code": "",
                        "Config.tasks": {}, "Config.signPoint": -1,
                        "Config.dailySetCompleted": 0, "Config.dailySetProcessed": [],
                        "Config.punchCardDetailDate": 0, "Config.punchCardDetailState": 0,
                        "Config.punchCardDate": 0, "Config.punchCardState": 0,
                        "Config.lastSearchProgress": -1, "Config.restrictedTimes": 0
                    };
                    for (const [key, value] of Object.entries(cleared)) GM_setValue(key, value);
                    // 使其他已运行的标签页丢弃旧 Token 和尚未处理的响应。
                    GM_setValue("Config.sessionResetId", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
                }
                GM_log(`🔒 ${reason}，已停止全部任务。请确认 Bing 登录后刷新重试。`);
            }
            return this.error();
        },

        isWebRequest(url) {
            const host = new URL(url).hostname;
            return ["rewards.bing.com", "www.bing.com", "cn.bing.com", "bing.com"].includes(host);
        },

        isBingHost(host) {
            return ["www.bing.com", "cn.bing.com", "bing.com"].includes(host);
        },

        probeUrl() {
            const current = typeof location !== "undefined" ? location.hostname : "";
            const host = this.isBingHost(current) ? current
                : this.isBingHost(RewardsAuto.state.host) ? RewardsAuto.state.host : "www.bing.com";
            return `https://${host}/?_rauto_session=${Date.now()}`;
        },

        needsLogin(url) {
            const host = new URL(url).hostname;
            return this.isWebRequest(url) || ["prod.rewardsplatform.microsoft.com", "login.live.com"].includes(host);
        },

        // 只读取新取得的 Bing HTML，不执行网页脚本，也不使用当前页面的旧 DOM 作为兜底。
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
                    // isRewardsUser=false 也可能只是未加入 Rewards，不能单独当作退出。
                    rewardsSignedIn = content.isRewardsUser === true || content.isAccountLogin === true;
                } catch (_) {}
            }
            const positive = accountVisible || rewardsSignedIn;
            const state = positive && !signInVisible ? "signed-in"
                : signInVisible && !positive ? "signed-out" : "unknown";
            return { state, accountVisible, signInVisible, rewardsSignedIn };
        },

        async ensure() {
            this.assertActive();
            if (this.checking) return this.checking;
            this.checking = (async () => {
                const url = this.probeUrl();
                try {
                    const response = await Utils.xhr({
                        url, sessionProbe: true, fullResponse: true,
                        headers: { "cache-control": "no-cache", "user-agent": RewardsAuto.ua.pc, "referer": new URL(url).origin + "/" }
                    });
                    this.assertActive();
                    const destination = new URL(response.finalUrl || url);
                    if (["login.live.com", "login.microsoftonline.com"].includes(destination.hostname)
                        || this.isBingHost(destination.hostname) && /^\/fd\/auth\/(?:signin|signout)(?:\/|$)/i.test(destination.pathname)) {
                        throw this.stop("Bing 网页已退出登录", true);
                    }
                    if (!this.isBingHost(destination.hostname)) throw this.stop("Bing 登录检查跳转到了其他网站");
                    const login = this.readBingLogin(response.responseText);
                    if (login.state === "signed-out") throw this.stop("Bing 网页已退出登录", true);
                    if (login.state !== "signed-in") {
                        throw this.stop("Bing 页面未提供明确的登录状态，暂时无法确认");
                    }
                    this.assertActive();
                    if (!this.verified) {
                        this.verified = true;
                        Utils.log("🟢", "Bing 网页登录已确认");
                    }
                    return true;
                } catch (e) {
                    if (e.code === "WEB_SESSION_STOPPED") throw e;
                    // HTTP 错误也可能来自接口兼容性或网络，不能据此删除授权。
                    throw this.stop(`暂时无法确认 Bing 登录状态${e.status ? `（HTTP ${e.status}）` : ""}`);
                }
            })();
            try { return await this.checking; }
            finally { this.checking = null; }
        },

        async run(action) {
            try {
                await this.ensure();
                const result = await action();
                this.assertActive();
                return result;
            } catch (e) {
                if (e.code !== "WEB_SESSION_STOPPED" && !this.isStopped()) Utils.log("🔴", `任务执行异常: ${e.message}`);
            }
        }
    };

    const Utils = {
        isRegionLockEnabled() {
            if (RewardsAuto.lockRegion !== true) return false;
            const saved = GM_getValue("Config.lock", true);
            // 兼容管理器存储编辑器中的布尔值、数字及文本。
            if (typeof saved === "string") {
                const value = saved.trim().toLowerCase();
                if (value === "false" || value === "0") return false;
            }
            return saved !== false && saved !== 0;
        },

        // 日志输出（带通知支持）
        log(icon, msg, push = false) {
            if (WebSession.isStopped()) return;
            GM_log(`${icon} ${msg}`);
            if (push && GM_getValue("Notice.bro", true)) {
                try {
                    GM_notification({
                        title: GM_info.script.name + ` ${icon}`,
                        text: msg,
                        onclick: () => GM_openInTab("https://rewards.bing.com/dashboard", { active: true })
                    });
                } catch(_) {}
            }
            // 发送到外部通知接口
            if (push) {
                RewardsAuto.state.sendMSG = `${icon} ${msg}`;
                this.sendWebhook();
            }
        },

        // 非国内 IP 仅在当天首次检测到时通知，避免定时任务重复弹窗。
        notifyNonDomesticIp(message = "IP非大陆，已暂停全部任务") {
            const noticeKey = "Config.ipPauseNoticeDate";
            const today = this.getTodayNum();
            if (GM_getValue(noticeKey, 0) === today) {
                GM_log("🟡 非大陆 IP 通知今日已发送，跳过重复通知");
                return false;
            }

            GM_setValue(noticeKey, today);
            this.log("🔴", message, true);
            return true;
        },

        // 发送webhook通知
        async sendWebhook() {
            await Promise.all(Webhooks.map(async (i) => {
                if (!i.key) return;
                const safeKey = String(i.key).trim();
                const targetUrl = safeKey.startsWith("http") ? safeKey : i.url + safeKey;
                try {
                    const result = await this.xhr({
                        method: "POST",
                        url: targetUrl,
                        headers: {
                            "content-type": "application/json; charset=UTF-8",
                        },
                        data: JSON.stringify(i.msg),
                    });
                    if (result) GM_log(`🔵 「${i.name}」消息推送完成`);
                } catch (e) {
                    GM_log(`🔴 「${i.name}」消息推送出错: ${e.message}`);
                }
            }));
        },

        // 封装 GM_xmlhttpRequest，15秒超时，支持重定向
        async xhr(options) {
            const { sessionProbe = false, fullResponse = false, ...requestOptions } = options;
            const protectedRequest = WebSession.needsLogin(requestOptions.url);
            if (!sessionProbe) {
                WebSession.assertActive();
                if (protectedRequest) await WebSession.ensure();
                WebSession.assertActive();
            }
            return new Promise((resolve, reject) => {
                const start = Date.now();
                GM_xmlhttpRequest({
                    anonymous: false,
                    ...requestOptions,
                    timeout: 15000,
                    onload: async (res) => {
                        try {
                            if (!sessionProbe) {
                                WebSession.assertActive();
                                // 请求期间退出登录时，不再把已返回的账号数据交给任务。
                                // 业务接口的 401/403 也只触发 Bing 复查，不代表整个账号已退出。
                                if (protectedRequest) await WebSession.ensure();
                                WebSession.assertActive();
                            }
                            const cost = ((Date.now() - start) / 1000).toFixed(2);
                            if (res.status >= 200 && res.status < 300) {
                                resolve(fullResponse ? res : res.responseText);
                            } else if ([301, 302, 307, 308].includes(res.status)) {
                                const match = res.responseHeaders?.match(/Location:\s*(.*?)\s*\r?\n/i);
                                resolve(fullResponse ? res : match ? match[1] : false);
                            } else {
                                reject(Object.assign(new Error(`HTTP ${res.status}，用时 ${cost} 秒`), { status: res.status }));
                            }
                        } catch (e) {
                            reject(e);
                        }
                    },
                    onerror: (err) => {
                        const cost = ((Date.now() - start) / 1000).toFixed(2);
                        reject(new Error(`${err?.error || "网络错误"}，用时 ${cost} 秒`));
                    },
                    ontimeout: () => {
                        const cost = ((Date.now() - start) / 1000).toFixed(2);
                        reject(new Error(`请求超时，用时 ${cost} 秒`));
                    }
                });
            });
        },

        randomRange(min, max) {
            return Math.floor(Math.random() * (max - min + 1) + min);
        },

        getTimestamp() {
            return Date.now();
        },

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
        },

        delay(ms) {
            WebSession.assertActive();
            return new Promise((resolve, reject) => setTimeout(() => {
                try { WebSession.assertActive(); resolve(); }
                catch (e) { reject(e); }
            }, ms));
        },

        // 防封号核心：所有操作间必须使用随机延迟
        randomDelay(min = 3000, max = 8000) {
            return this.delay(this.randomRange(min, max));
        },

        waitForElement(selector, timeout = 30000) {
            return new Promise((resolve, reject) => {
                const element = document.querySelector(selector);
                if (element) return resolve(element);

                const observer = new MutationObserver((_, obs) => {
                    const el = document.querySelector(selector);
                    if (el) { obs.disconnect(); resolve(el); }
                });
                observer.observe(document.body, { childList: true, subtree: true });

                setTimeout(() => {
                    observer.disconnect();
                    const el = document.querySelector(selector);
                    el ? resolve(el) : reject(new Error(`等待元素超时: ${selector}`));
                }, timeout);
            });
        },

        waitForElementsByText(containerSelector, textPatterns, timeout = 30000) {
            return new Promise((resolve, reject) => {
                const findElements = () => {
                    const containers = document.querySelectorAll(containerSelector);
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

                const found = findElements();
                if (found.length > 0) return resolve(found);

                const observer = new MutationObserver((_, obs) => {
                    const found = findElements();
                    if (found.length > 0) { obs.disconnect(); resolve(found); }
                });
                observer.observe(document.body, { childList: true, subtree: true });

                setTimeout(() => {
                    observer.disconnect();
                    const found = findElements();
                    found.length > 0 ? resolve(found) : reject(new Error("等待文本元素超时"));
                }, timeout);
            });
        }
    };

    const UserInfoSession = {
        storageKey: "Config.userInfoSessionRecovery.v2",
        recoveryTimeout: 45000,
        fallbackTimeout: 45000,
        cooldown: 10 * 60 * 1000,
        pending: null,
        unavailable: false,
        attempted: false,
        warned: false,
        failureMessage: "",

        beginRun() {
            if (this.pending) return;
            this.unavailable = this.attempted = this.warned = false;
            this.failureMessage = "";
        },

        url() {
            return "https://rewards.bing.com/api/getuserinfo?type=1&X-Requested-With=XMLHttpRequest";
        },

        loginUrl() {
            return "https://rewards.bing.com/createuser?code=401&userScenarioId=anonsignin&idru=" +
                encodeURIComponent(this.url());
        },

        valid(data) {
            if (!data || typeof data !== "object" || Array.isArray(data)) return false;
            const dashboard = data.dashboard || data, status = dashboard.userStatus;
            if (!status || typeof status !== "object" || Array.isArray(status)) return false;
            if ([data, dashboard, status].some(item =>
                ["isAuthenticated", "isSignedIn", "isLoggedIn"].some(key => item[key] === false))) return false;
            const points = status.availablePoints ?? dashboard.availablePoints ?? data.balance;
            return (typeof points === "number" || typeof points === "string" && /^\d+$/.test(points)) &&
                Number.isSafeInteger(Number(points)) && Number(points) >= 0;
        },

        pause(ms) {
            return Utils.delay(ms);
        },

        async request(options, timeout = 15000) {
            // 保留正式版的会话恢复请求；Bing 退出后不得继续认证或读取返回数据。
            await WebSession.ensure();
            const response = await new Promise((resolve, reject) => {
                let finished = false, handle;
                const timeoutMs = Math.max(1, Math.min(15000, timeout));
                const settle = (callback, value) => {
                    if (finished) return;
                    finished = true;
                    clearTimeout(watchdog);
                    callback(value);
                };
                const timeoutError = () => new Error("getuserinfo 后台请求超时");
                const watchdog = setTimeout(() => {
                    settle(reject, timeoutError());
                    try { handle?.abort?.(); } catch (_) {}
                }, timeoutMs);
                try {
                    handle = GM_xmlhttpRequest({
                        method: "GET", ...options,
                        anonymous: false, timeout: timeoutMs,
                        onload: response => settle(resolve, response),
                        onerror: () => settle(reject, new Error("getuserinfo 网络请求失败")),
                        ontimeout: () => settle(reject, timeoutError()),
                        onabort: () => settle(reject, new Error("getuserinfo 请求已取消"))
                    });
                    if (handle && typeof handle.catch === "function") {
                        handle.catch(() => settle(reject, new Error("getuserinfo 请求无法发出")));
                    }
                } catch (_) {
                    if (_?.code === "WEB_SESSION_STOPPED") throw _;
                    settle(reject, new Error("getuserinfo 请求无法发出"));
                }
            });
            await WebSession.ensure();
            return response;
        },

        async read(timeout = 15000) {
            const response = await this.request({
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
                    finalUrl.pathname !== "/api/getuserinfo" || !this.valid(data)) throw new Error("invalid data");
                return data;
            } catch (_) {
                if (_?.code === "WEB_SESSION_STOPPED") throw _;
                throw new Error("getuserinfo 未返回有效用户数据");
            }
        },

        authUrl(value, base) {
            const url = new URL(value, base);
            if (url.protocol !== "https:" || url.username || url.password || url.port) {
                throw new Error("后台认证地址无效");
            }
            const rewardsRoute = url.hostname === "rewards.bing.com" &&
                /^\/(?:createuser|signin|signin-oidc|api\/getuserinfo)\/?$/i.test(url.pathname);
            const microsoftRoute = url.hostname === "login.live.com" &&
                /^\/(?:oauth20_authorize\.srf|login\.srf)$/i.test(url.pathname);
            if (!rewardsRoute && !microsoftRoute) throw new Error("后台认证遇到未支持的跳转");
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

        callbackForm(html, responseUrl) {
            const origin = this.authUrl(responseUrl).origin;
            if (origin !== "https://login.live.com" || String(html).length > 1024 * 1024) return null;
            const text = String(html).replace(/<!--[\s\S]*?-->|<(script|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
            const forms = [...text.matchAll(/<form\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/form\s*>/gi)];
            if (forms.length !== 1) return null;
            const attrs = this.attributes(forms[0][1]);
            if (String(attrs.method).toLowerCase() !== "post" || !attrs.action ||
                attrs.enctype && attrs.enctype.toLowerCase() !== "application/x-www-form-urlencoded") return null;
            const action = this.authUrl(attrs.action, responseUrl);
            if (action.href !== "https://rewards.bing.com/signin-oidc") return null;
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

        async authenticate(deadline) {
            let request = { url: this.loginUrl() }, posted = false, silentRequested = false;
            for (let hops = 0; hops < 8 && Date.now() < deadline; hops++) {
                this.authUrl(request.url);
                const response = await this.request({ ...request,
                    headers: { "accept": "text/html,application/xhtml+xml", ...request.headers }
                }, deadline - Date.now());
                const finalUrl = this.authUrl(response.finalUrl || request.url);
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
                if (!posted && !silentRequested && finalUrl.origin === "https://login.live.com" &&
                    finalUrl.pathname === "/oauth20_authorize.srf" &&
                    finalUrl.searchParams.get("redirect_uri") === "https://rewards.bing.com/signin-oidc" &&
                    finalUrl.searchParams.get("response_mode") === "form_post" && finalUrl.searchParams.has("state") &&
                    !/\b(?:login_required|interaction_required|consent_required|account_selection_required)\b/i.test(response.responseText)) {
                    silentRequested = true;
                    finalUrl.searchParams.set("prompt", "none");
                    request = { url: finalUrl.href };
                    continue;
                }
                return;
            }
        },

        async recoverWithoutTab() {
            const deadline = Date.now() + this.recoveryTimeout;
            try { await this.authenticate(deadline); } catch (_) { if (_?.code === "WEB_SESSION_STOPPED") throw _; }
            for (let checks = 0; checks < 2 && Date.now() < deadline; checks++) {
                if (checks) await this.pause(Math.min(1000, deadline - Date.now()));
                if (Date.now() >= deadline) break;
                try { return await this.read(deadline - Date.now()); }
                catch (error) {
                    if (error?.code === "WEB_SESSION_STOPPED") throw error;
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

        async openFallbackTab() {
            await WebSession.ensure();
            let timer, expired = false;
            const opening = Promise.resolve(GM_openInTab(this.loginUrl(), {
                active: false, insert: true, setParent: true
            })).then(tab => {
                if (expired || WebSession.isStopped()) this.closeTab(tab);
                WebSession.assertActive();
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

        async recoverWithTab() {
            let tab = null;
            const deadline = Date.now() + this.fallbackTimeout;
            try {
                tab = await this.openFallbackTab();
                for (let checks = 0; checks < 12 && Date.now() < deadline; checks++) {
                    if (tab?.closed === true) break;
                    await this.pause(Math.min(3000, deadline - Date.now()));
                    if (Date.now() >= deadline) break;
                    try { return await this.read(deadline - Date.now()); }
                    catch (error) {
                        if (error?.code === "WEB_SESSION_STOPPED") throw error;
                        if (error.status === 403 || error.status === 429) break;
                    }
                }
            } catch (_) {
                if (_?.code === "WEB_SESSION_STOPPED") throw _;
            } finally { this.closeTab(tab); }
            return null;
        },

        warn(message, quiet) {
            this.failureMessage = message;
            if (quiet || this.warned) return;
            this.warned = true;
            Utils.log("🟡", message);
        },

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

        async load(quiet) {
            try {
                return await this.read();
            } catch (error) {
                if (error?.code === "WEB_SESSION_STOPPED") throw error;
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
            try { data = await this.recover(quiet); } catch (_) { if (_?.code === "WEB_SESSION_STOPPED") throw _; }
            if (!data) {
                this.unavailable = true;
                this.warn(this.failureMessage || "getuserinfo 两次恢复均未完成，本轮继续使用其他数据来源", quiet);
            }
            return data;
        },

        async waitForOther(record) {
            const deadline = Math.min(record.expiresAt, Date.now() + this.recoveryTimeout + this.fallbackTimeout + 5000);
            while (Date.now() < deadline) {
                const latest = await GM_getValue(this.storageKey, null);
                if (!latest || latest.id !== record.id) break;
                if (latest.state === "ready") {
                    try { return await this.read(deadline - Date.now()); } catch (_) {
                        if (_?.code === "WEB_SESSION_STOPPED") throw _;
                        break;
                    }
                }
                if (latest.state !== "running") break;
                await this.pause(Math.min(500, deadline - Date.now()));
            }
            return null;
        },

        async recover(quiet) {
            const now = Date.now(), previous = await GM_getValue(this.storageKey, null);
            if (previous?.state === "running" && previous.expiresAt > now) return this.waitForOther(previous);
            const nextAttemptAt = previous?.state === "failed"
                ? Math.min(previous.nextAttemptAt, previous.expiresAt + this.cooldown)
                : previous?.nextAttemptAt;
            if (nextAttemptAt > now) {
                this.warn("getuserinfo 自动恢复处于 10 分钟冷却期，本轮继续使用其他数据来源", quiet);
                return null;
            }
            const id = now + "-" + Math.random().toString(36).slice(2);
            await GM_setValue(this.storageKey, {
                id, state: "running", expiresAt: now + this.recoveryTimeout + this.fallbackTimeout + 5000,
                nextAttemptAt: 0
            });
            await this.pause(150 + Math.floor(Math.random() * 150));
            const owner = await GM_getValue(this.storageKey, null);
            if (owner?.id !== id) return owner ? this.waitForOther(owner) : null;

            let data = null, method = "";
            try {
                if (!quiet) Utils.log("🟡", "getuserinfo 开始恢复（最多 45 秒）");
                try { data = await this.recoverWithoutTab(); } catch (_) { if (_?.code === "WEB_SESSION_STOPPED") throw _; }
                if (data) method = "xhr";
                if (!data) {
                    if (!quiet) Utils.log("🟡", "getuserinfo 恢复未成功，启用后台标签页兜底（最多 45 秒）");
                    data = await this.recoverWithTab();
                    if (data) method = "tab";
                }
            } catch (_) {
                if (_?.code === "WEB_SESSION_STOPPED") throw _;
            } finally {
                try {
                    const latest = await GM_getValue(this.storageKey, null);
                    if (latest?.id === id) await GM_setValue(this.storageKey, {
                        id, state: data ? "ready" : "failed", expiresAt: Date.now(),
                        nextAttemptAt: data ? 0 : Date.now() + this.cooldown, method
                    });
                } catch (_) { if (_?.code === "WEB_SESSION_STOPPED") throw _; }
            }
            if (data && !quiet) Utils.log("🟢", method === "xhr"
                ? "getuserinfo 恢复成功，已验证有效用户数据"
                : "getuserinfo 后台标签页兜底成功，已验证有效用户数据并关闭登录页");
            return data;
        }
    };

    const API = {
        _readOfferId: "",
        _readOfferLogDate: 0,

        // 领取积分和活动接口的响应只接受明确成功标记，避免 HTTP 200 被误判为完成。
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

            // Next.js Server Action 返回 RSC 分行记录，例如：
            // 0:{"a":"$@1",...}\n1:true。第一行的 a 字段引用第二行的结果。
            // 先解引用再做通用判断，避免把 RSC 元数据中的 false 当成失败。
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
                    // Unknown RSC chunks are intentionally ignored; only an
                    // explicit boolean/object success result can confirm a claim.
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
                    // Server Action wrappers have used both `a` and `data`/`result`.
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

            // Some deployments omit the wrapper and return a single `1:true` chunk.
            for (const value of records.values()) {
                const result = resolveRecord(value);
                if (result === true || result === false) return result;
            }

            // Non-RSC responses still use the regular JSON/text markers.
            return inspect(response);
        },

        async getToken(url, maxRetries = 3) {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const res = await Utils.xhr({ url });
                    if (!Utils.isJSON(res)) {
                        if (attempt < maxRetries) {
                            await Utils.delay(3210);
                            continue;
                        }
                        return false;
                    }
                    const data = JSON.parse(res);
                    if (data.error) {
                        Utils.log("🔴", `Token错误: ${data.error} - ${data.error_description || ''}`);
                        if (["invalid_grant","invalid_request"].includes(data.error)) {
                            GM_setValue("Config.token", false);
                            GM_setValue("Config.code", "");
                        }
                        return false;
                    }
                    if (data.refresh_token && data.access_token) {
                        GM_setValue("Config.token", data.refresh_token);
                        GM_setValue("Config.tokenTime", Utils.getTimestamp());
                        RewardsAuto.state.token = data.access_token;
                        return true;
                    }
                    if (attempt < maxRetries) {
                        await Utils.delay(3210);
                        continue;
                    }
                    return false;
                } catch (e) {
                    if (e?.code === "WEB_SESSION_STOPPED") throw e;
                    if (e.message.includes("400") || e.message.includes("401")) {
                        GM_setValue("Config.token", false);
                        GM_setValue("Config.code", "");
                        return false;
                    }
                    if (attempt < maxRetries) {
                        await Utils.delay(3210);
                        continue;
                    }
                    Utils.log("🔴", `Token请求失败: ${e.message}`);
                    return false;
                }
            }
            return false;
        },

        // 401 自动刷新 Token 并重试
        async withTokenRetry(requestFn) {
            WebSession.assertActive();
            let token = RewardsAuto.state.token;
            if (!token) return null;
            try {
                return await requestFn(token);
            } catch (e) {
                if (e.code === "WEB_SESSION_STOPPED") throw e;
                if (e.message && e.message.includes("401")) {
                    Utils.log("🟡", "Token 过期，强制重新授权...");
                    RewardsAuto.state.token = null;
                    GM_setValue("Config.token", false);
                    GM_setValue("Config.tokenTime", 0);
                    const refreshed = await this.renewToken();
                    if (!refreshed) return null;
                    return await requestFn(RewardsAuto.state.token);
                }
                throw e;
            }
        },

        async renewToken() {
            await WebSession.ensure();
            if (!GM_getValue("Tasks.sign", true) && !GM_getValue("Tasks.read", true)) return true;
            
            let refreshToken = GM_getValue("Config.token", false);
            const tokenTime = GM_getValue("Config.tokenTime", 0);
            
            // Token 超过 7 天提前续期
            if (tokenTime > 0) {
                const days = (Utils.getTimestamp() - tokenTime) / (1000 * 60 * 60 * 24);
                if (days > 7) {
                    Utils.log("🟡", `Token已${Math.floor(days)}天，提前续期`);
                    refreshToken = false;
                }
            }

            const authUrl = "https://login.live.com/oauth20_authorize.srf?client_id=0000000040170455&response_type=code&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL&redirect_uri=https://login.live.com/oauth20_desktop.srf";

            // 自动获取授权码，失败时再打开授权页让用户手动处理
            const fetchCode = async (msg) => {
                GM_setValue("Config.code", "");
                Utils.log("🟡", `${msg}，尝试自动获取授权码...`);
                
                try {
                    const res = await Utils.xhr({
                        method: "GET", url: authUrl, fullResponse: true,
                        headers: { "User-Agent": navigator.userAgent }
                    });
                    const finalUrl = res.finalUrl || "";
                    const code = new URL(finalUrl).searchParams.get("code");
                    if (code) {
                        Utils.log("🟢", "自动获取授权码成功");
                        return [code];
                    }
                } catch (e) {
                    if (e.code === "WEB_SESSION_STOPPED") throw e;
                    Utils.log("🟡", `自动获取失败: ${e.message}`);
                }

                await WebSession.ensure();
                Utils.log("🟡", "请手动完成授权...");
                GM_openInTab(authUrl, { active: true, insert: true, setParent: true });

                if (GM_getValue("Notice.bro", true)) {
                    try {
                        GM_notification({
                            text: "完成后粘贴地址栏URL到脚本设置的「授权码链接」",
                            title: "🟡 需要授权", timeout: 0
                        });
                    } catch(_) {}
                }

                // 等待用户粘贴或授权页自动捕获授权码（最长 3 分钟）
                for (let i = 0; i < 180; i++) {
                    await Utils.delay(1000);
                    const raw = GM_getValue("Config.code", "");
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
                        Utils.log("🟢", "授权码获取成功");
                        return [code];
                    }
                }
                Utils.log("🔴", "授权码获取超时", true);
                return false;
            };

            // 根据是否有 refreshToken 决定获取方式
            if (!refreshToken) {
                const codeMatch = await fetchCode("检测到授权码为空");
                if (!codeMatch) return false;
                const url = `https://login.live.com/oauth20_token.srf?client_id=0000000040170455&code=${encodeURIComponent(codeMatch[0])}&redirect_uri=https://login.live.com/oauth20_desktop.srf&grant_type=authorization_code`;
                const token = await this.getToken(url);
                if (!token) {
                    const retry = await fetchCode("授权码失效");
                    if (!retry) return false;
                    return await this.renewToken();
                }
                Utils.log("🟢", "Token获取成功！", true);
                return true;
            } else {
                const url = `https://login.live.com/oauth20_token.srf?client_id=0000000040170455&refresh_token=${encodeURIComponent(refreshToken)}&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL&grant_type=REFRESH_TOKEN`;
                const token = await this.getToken(url);
                if (!token) {
                    const retry = await fetchCode("Token失效");
                    if (!retry) return false;
                    return await this.renewToken();
                }
                return true;
            }
        },

        // 优先从 earn 页面“今日积分”表格解析，DAPI 只做兜底
        async getRewardsInfo(maxRetries = 3) {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const html = await Utils.xhr({ url: "https://rewards.bing.com/earn" });
                    const clean = html.replace(/\\"/g, '"');
                    
                    // 尝试从Next.js RSC数据中解析
                    let balance = 0;
                    let pcMax = 60, pcCur = 0, mobMax = 0, mobCur = 0;
                    let dailyOffer = 0;
                    let searchQuotaFound = false;
                    
                    // 从 RSC JSON 数据中解析 pointsCounters（兼容有/无 mobile 字段、不同字段顺序）
                    const pcIdx = clean.indexOf('"pointsCounters":{');
                    if (pcIdx !== -1) {
                        let start = pcIdx + 17, depth = 0, end = start;
                        for (let i = start; i < clean.length && i < start + 500; i++) {
                            if (clean[i] === '{') depth++;
                            if (clean[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
                        }
                        try {
                            const pts = JSON.parse(clean.substring(start, end));
                            pcMax = pts.pc?.max ?? 60;
                            pcCur = pts.pc?.progress ?? 0;
                            mobMax = pts.mobile?.max ?? 0;
                            mobCur = pts.mobile?.progress ?? 0;
                            dailyOffer = pts.dailyOffer ?? 0;
                            if (pts.totalPoints != null) balance = Number(pts.totalPoints);
                        } catch {}
                    }

                    // 补充获取 balance
                    if (balance === 0) {
                        const balMatch = clean.match(/"balance":(\d+)/) || clean.match(/"availablePoints":(\d+)/);
                        if (balMatch) balance = parseInt(balMatch[1]);
                    }

                    // 解析今日积分明细
                    const todayDetails = [];
                    
                    // 从RSC数据中解析活动卡片（括号深度匹配，兼容嵌套数组）
                    const acIdx = clean.indexOf('"activityCards":[');
                    if (acIdx !== -1) {
                        let acStart = acIdx + 16, acDepth = 0, acEnd = acStart;
                        for (let i = acStart; i < clean.length && i < acStart + 5000; i++) {
                            if (clean[i] === '[') acDepth++;
                            if (clean[i] === ']') { acDepth--; if (acDepth === 0) { acEnd = i + 1; break; } }
                        }
                        try {
                            const cardsStr = clean.substring(acStart, acEnd);
                            const cardRegex = /"title":"([^"]+)".*?"points":(\d+).*?"isCompleted":(true|false)/g;
                            let cardMatch;
                            while ((cardMatch = cardRegex.exec(cardsStr)) !== null) {
                                const title = cardMatch[1];
                                const points = parseInt(cardMatch[2]);
                                const isCompleted = cardMatch[3] === "true";
                                if (points > 0 && isCompleted) {
                                    todayDetails.push({ title, points });
                                }
                            }
                        } catch {}
                    }
                    
                    // 方法2: 从HTML中解析搜索进度
                    const toNum = value => parseInt(String(value).replace(/,/g, ''), 10) || 0;
                    const searchRowMatch = clean.match(/<p>\s*必应搜索\s*<\/p>\s*<\/div>\s*<div(?=[^>]*justify-self-end)[^>]*>([\s\S]{0,500}?)<\/div>/i);
                    const searchHtmlMatch = searchRowMatch
                        ? (searchRowMatch[1].match(/<span[^>]*>([\d,]+)<\/span>\s*<span[^>]*>\s*\/\s*([\d,]+)\s*<\/span>/i)
                            || searchRowMatch[1].match(/([\d,]+)\s*\/\s*([\d,]+)/))
                        : null;
                    if (searchHtmlMatch) {
                        pcCur = toNum(searchHtmlMatch[1]);
                        pcMax = toNum(searchHtmlMatch[2]);
                        searchQuotaFound = pcMax > 0;
                        todayDetails.push({ 
                            title: '必应搜索', 
                            points: pcCur,
                            max: pcMax
                        });
                        Utils.log("🔍", `页面表格配额: PC ${pcCur}/${pcMax}`);
                    }
                    
                    // 方法3: 从RSC数据中解析搜索进度
                    const searchRscMatch = clean.match(/"combinedSearch":\{[^}]*"progress":(\d+)[^}]*"max":(\d+)/);
                    if (searchRscMatch && !todayDetails.some(d => d.title === '必应搜索')) {
                        pcCur = toNum(searchRscMatch[1]);
                        pcMax = toNum(searchRscMatch[2]);
                        searchQuotaFound = pcMax > 0;
                        todayDetails.push({
                            title: '必应搜索',
                            points: pcCur,
                            max: pcMax
                        });
                    }
                    
                    // 添加dailyOffer到今日明细
                    if (dailyOffer > 0) {
                        todayDetails.push({ title: '优惠', points: dailyOffer });
                    }
                    
                    // 匹配其他活动（如"优惠"）
                    const otherActivityRegex = /<p>([^<]+)<\/p><\/div><div[^>]*>(\d+)<\/div>/g;
                    let otherMatch;
                    while ((otherMatch = otherActivityRegex.exec(clean)) !== null) {
                        const title = otherMatch[1];
                        const points = parseInt(otherMatch[2]);
                        if (points > 0 && !todayDetails.some(d => d.title === title)) {
                            todayDetails.push({ title, points });
                        }
                    }

                    // 解析历史积分
                    const history = {
                        month: 0,
                        year: 0,
                        lifetime: 0
                    };
                    
                    // 方法1: 从RSC数据中解析历史积分
                    const historyRscMatch = clean.match(/"pointsHistory":\{[^}]*"thisMonth":\{"earn":(\d+)[^}]*"thisYear":\{"earn":(\d+)[^}]*"lifetime":\{"earn":(\d+)/);
                    if (historyRscMatch) {
                        history.month = parseInt(historyRscMatch[1]);
                        history.year = parseInt(historyRscMatch[2]);
                        history.lifetime = parseInt(historyRscMatch[3]);
                    } else {
                        // 方法2: 从HTML中解析历史积分
                        const monthHtmlMatch = clean.match(/本月.*?(\d[\d,]*)<\/div>/);
                        const yearHtmlMatch = clean.match(/今年.*?(\d[\d,]*)<\/div>/);
                        const lifetimeHtmlMatch = clean.match(/生存期.*?(\d[\d,]*)<\/div>/);
                        
                        // JSON格式
                        const monthJsonMatch = clean.match(/"monthlyPoints":(\d+)/);
                        const yearJsonMatch = clean.match(/"yearlyPoints":(\d+)/);
                        const lifetimeJsonMatch = clean.match(/"lifetimePoints":(\d+)/);
                        
                        if (monthHtmlMatch) {
                            history.month = parseInt(monthHtmlMatch[1].replace(/,/g, ''));
                        } else if (monthJsonMatch) {
                            history.month = parseInt(monthJsonMatch[1]);
                        }
                        
                        if (yearHtmlMatch) {
                            history.year = parseInt(yearHtmlMatch[1].replace(/,/g, ''));
                        } else if (yearJsonMatch) {
                            history.year = parseInt(yearJsonMatch[1]);
                        }
                        
                        if (lifetimeHtmlMatch) {
                            history.lifetime = parseInt(lifetimeHtmlMatch[1].replace(/,/g, ''));
                        } else if (lifetimeJsonMatch) {
                            history.lifetime = parseInt(lifetimeJsonMatch[1]);
                        }
                    }

                    if (!searchQuotaFound) {
                        const userInfoResult = await this.getSearchQuotaFromUserInfo();
                        if (userInfoResult) {
                            Utils.log("🟢", "页面未命中搜索配额，使用 getuserinfo 兜底");
                            return userInfoResult;
                        }
                    }

                    if (!searchQuotaFound && RewardsAuto.state.token) {
                        const apiResult = await this.getSearchQuotaFromAPI();
                        if (apiResult) {
                            Utils.log("🟢", "页面未命中搜索配额，使用 DAPI 兜底");
                            return apiResult;
                        }
                    }

                    return {
                        balance,
                        pc: { progress: pcCur, max: pcMax },
                        mobile: { progress: mobCur, max: mobMax },
                        readProgress: RewardsAuto.state.readProgress,
                        readMax: RewardsAuto.state.readMax,
                        dailyOffer,
                        todayDetails,
                        history
                    };
                } catch (e) {
                    if (e?.code === "WEB_SESSION_STOPPED") throw e;
                    if (attempt < maxRetries) {
                        await Utils.delay(3210);
                        continue;
                    }
                    Utils.log("🔴", `仪表盘获取失败: ${e.message}`);
                    return false;
                }
            }
            return false;
        },

        async signApp() {
            const region = Utils.isRegionLockEnabled() ? "cn" : RewardsAuto.state.region.toLowerCase();
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    method: "POST",
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me/activities",
                    headers: {
                        "content-type": "application/json; charset=UTF-8",
                        "user-agent": RewardsAuto.ua.app,
                        "authorization": `Bearer ${token}`,
                        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                        "x-rewards-ismobile": "true",
                        "x-rewards-country": region,
                        "x-rewards-language": "zh",
                        "x-rewards-partnerid": "startapp",
                        "x-rewards-flights": "rwgobig"
                    },
                    data: JSON.stringify({
                        amount: 1, id: Utils.getRandomUUID().replace(/-/g, '') + Utils.getRandomUUID().replace(/-/g, '').slice(0, 24),
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
                    Utils.log("🟡", `App签入响应未确认: ${String(res).slice(0, 120)}`);
                }
            } catch (e) {
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                Utils.log("🔴", `App签入失败: ${e.message}`);
            }
            return -1;
        },

        async getRequestVerificationToken(pageUrl = "https://rewards.bing.com/") {
            try {
                // destinationUrl 可能是第三方活动跳转页，只能从 Rewards 来源页取令牌。
                const sourceUrl = new URL(pageUrl, "https://rewards.bing.com/");
                if (sourceUrl.origin !== "https://rewards.bing.com") {
                    throw new Error("验证令牌只能从 Rewards 来源页获取");
                }
                const html = await Utils.xhr({
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
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                Utils.log("🟡", `活动Token获取失败: ${e.message}`);
                return "";
            }
        },

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

            return await Utils.xhr({
                method: "POST",
                url: "https://rewards.bing.com/api/reportactivity?X-Requested-With=XMLHttpRequest",
                headers,
                data: params.toString(),
                anonymous: false
            });
        },

        // 每日活动上报：通过 reportActivity API 完成（匹配浏览器行为）
        async reportDailyActivity(searchUrl) {
            try {
                const fullUrl = searchUrl.startsWith("http") ? searchUrl : `https://cn.bing.com${searchUrl}`;
                const urlObj = new URL(fullUrl);
                const sp = urlObj.searchParams;
                const ig = Utils.getRandomUUID().replace(/-/g, '').substring(0, 32).toUpperCase();

                // cn.bing.com 版本的 URL（用作 referer 和 body url）
                const cnUrl = fullUrl.replace(/^https?:\/\/www\.bing\.com/, "https://cn.bing.com")
                                     .replace(/^https:\/\/bing\.com/, "https://cn.bing.com");
                const cnUrlObj = new URL(cnUrl);
                const cnSp = cnUrlObj.searchParams;

                // 构建 reportActivity 查询参数（匹配浏览器抓包：IID=commerce.5067，不含 ajaxreq）
                const reportParams = new URLSearchParams();
                reportParams.set("IG", ig);
                reportParams.set("IID", "commerce.5067");
                if (cnSp.get("form")) reportParams.set("form", cnSp.get("form"));
                if (cnSp.get("ocid") || cnSp.get("OCID")) reportParams.set("ocid", cnSp.get("ocid") || cnSp.get("OCID"));
                if (cnSp.get("rnoreward")) reportParams.set("rnoreward", cnSp.get("rnoreward"));

                // 步骤1: GET 加载活动页面（服务器记录访问）
                try {
                    await Utils.xhr({
                        method: "GET",
                        url: cnUrl,
                        headers: {
                            "user-agent": RewardsAuto.ua.pc,
                            "referer": "https://rewards.bing.com/",
                            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
                        }
                    });
                } catch (_) { if (_?.code === "WEB_SESSION_STOPPED") throw _; }

                // 步骤2: 发送 ncheader（匹配浏览器的预请求）
                const ncheaderParams = new URLSearchParams();
                ncheaderParams.set("ver", String(Date.now()).substring(0, 8));
                ncheaderParams.set("IID", "commerce.5057");
                ncheaderParams.set("IG", ig);
                try {
                    await Utils.xhr({
                        method: "POST",
                        url: `https://cn.bing.com/rewardsapp/ncheader?${ncheaderParams.toString()}`,
                        headers: {
                            "content-type": "application/x-www-form-urlencoded",
                            "user-agent": RewardsAuto.ua.pc,
                            "referer": cnUrl,
                            "origin": "https://cn.bing.com",
                            "accept": "*/*",
                            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
                        },
                        data: "wb=1;i=1;v=1"
                    });
                } catch (_) {
                    if (_?.code === "WEB_SESSION_STOPPED") throw _; /* ncheader 失败不阻断 */ }

                // 步骤3: 发送 reportActivity
                const bodyParams = new URLSearchParams();
                bodyParams.set("url", cnUrl);
                bodyParams.set("V", "web");

                await Utils.xhr({
                    method: "POST",
                    url: `https://cn.bing.com/rewardsapp/reportActivity?${reportParams.toString()}`,
                    headers: {
                        "content-type": "application/x-www-form-urlencoded",
                        "user-agent": RewardsAuto.ua.pc,
                        "referer": cnUrl,
                        "origin": "https://cn.bing.com",
                        "accept": "*/*",
                        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
                    },
                    data: bodyParams.toString()
                });
                return true;
            } catch (e) {
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                Utils.log("🟡", `每日活动上报失败: ${e.message}`);
                return false;
            }
        },

        async signPC() {
            try {
                const res = await this.reportActivity("Gamification_DailyCheckIn", "1", "https://rewards.bing.com/");
                if (Utils.isJSON(res)) {
                    const data = JSON.parse(res);
                    return Number(data.points || data.response?.activity?.p || 0);
                }
            } catch (e) {
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                if (e.message?.includes("401")) RewardsAuto.state.pc401 = true;
                Utils.log("🟡", `PC签入失败: ${e.message}`);
            }
            return -1;
        },

        async appActivity(type, offerid) {
            const region = Utils.isRegionLockEnabled() ? "cn" : RewardsAuto.state.region.toLowerCase();
            const body = {
                amount: 1,
                country: region,
                id: Utils.getRandomUUID().replace(/-/g, '') + Utils.getRandomUUID().replace(/-/g, '').slice(0, 24),
                type: type,
                channel: RewardsAuto.appConfig.channel
            };
            if (offerid) {
                body.attributes = { offerid: offerid };
            }
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    method: "POST",
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me/activities",
                    headers: {
                        "content-type": "application/json; charset=utf-8",
                        "user-agent": RewardsAuto.ua.app,
                        "authorization": `Bearer ${token}`,
                        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                        "x-rewards-ismobile": "true",
                        "x-rewards-country": region,
                        "x-rewards-language": "zh"
                    },
                    data: JSON.stringify(body)
                }));
                if (Utils.isJSON(res)) {
                    const data = JSON.parse(res);
                    const points = data.response?.activity?.p || 0;
                    const isDuplicate = data.response?.isDuplicate || false;
                    const balance = data.response?.balance || 0;
                    return { points, isDuplicate, balance };
                }
            } catch (e) {
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                Utils.log("🔴", `App活动失败(${offerid}): ${e.message}`);
            }
            return null;
        },

        async getReadProgress() {
            const region = Utils.isRegionLockEnabled() ? "cn" : RewardsAuto.state.region.toLowerCase();
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613",
                    headers: {
                        "content-type": "application/json; charset=UTF-8",
                        "user-agent": RewardsAuto.ua.app,
                        "authorization": `Bearer ${token}`,
                        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                        "x-rewards-ismobile": "true",
                        "x-rewards-country": region,
                        "x-rewards-language": "zh"
                    }
                }));
                if (Utils.isJSON(res)) {
                    const payload = JSON.parse(res);
                    const promos = Array.isArray(payload.response?.promotions) ? payload.response.promotions : [];
                    const configuredOfferId = String(RewardsAuto.appConfig.offerIds.readArticle || "").trim();
                    const getAttributes = item => item?.attributes && typeof item.attributes === "object"
                        ? item.attributes : item || {};
                    const getOfferId = item => String(getAttributes(item).offerid || getAttributes(item).offerId || "").trim();
                    const parseCounter = value => {
                        if (typeof value !== "number" && typeof value !== "string") return NaN;
                        if (typeof value === "string" && !/^\d+$/.test(value.trim())) return NaN;
                        const number = Number(value);
                        return Number.isSafeInteger(number) && number >= 0 ? number : NaN;
                    };
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
                            Utils.log("🟡", "阅读进度字段无效，无法确认完成状态");
                            return false;
                        }
                        RewardsAuto.state.readProgress = progress;
                        RewardsAuto.state.readMax = max;
                        this._readOfferId = readOfferId || configuredOfferId;
                        if (this._readOfferId.toLowerCase() !== configuredLower && this._readOfferLogDate !== RewardsAuto.state.dateNowNum) {
                            this._readOfferLogDate = RewardsAuto.state.dateNowNum;
                            Utils.log("🟡", `阅读任务使用动态 offerId: ${this._readOfferId}（配置值 ${configuredOfferId} 已不匹配）`);
                        }
                        Utils.log("📊", `阅读进度查询: ${progress}/${max} (offerid: ${readOfferId})`);
                        return { progress, max };
                    }
                    const ids = promos.map(getOfferId).filter(Boolean).slice(0, 20);
                    Utils.log("🟡", `阅读任务未找到 (配置 offerid: ${configuredOfferId})${ids.length ? `；DAPI offerid: ${ids.join(", ")}` : "；DAPI 未返回 promotions"}`);
                } else {
                    Utils.log("🟡", `DAPI 响应不是 JSON: ${String(res).substring(0, 100)}`);
                }
            } catch (e) {
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                Utils.log("🔴", `阅读进度获取失败: ${e.message}`);
            }
            return false;
        },

        // 获取 RequestVerificationToken（用于 reportactivity API）
        async getRewardsToken() {
            try {
                // 统一使用多格式解析器；旧的去空格正则只匹配一种 HTML 排版，
                // 页面改版后会把所有领取策略都误导向后续失败分支。
                const token = await this.getRequestVerificationToken("https://rewards.bing.com/");
                if (token) return token;
            } catch (e) {
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                Utils.log("🟡", `RequestVerificationToken 获取失败: ${e.message}`);
            }
            return false;
        },

        async getSearchQuotaFromUserInfo() {
            try {
                const data = await UserInfoSession.get();
                if (!data) return false;
                const dashboard = data.dashboard || data;
                const userStatus = dashboard.userStatus || {};
                const counters = userStatus.counters || {};

                const sumCounter = items => {
                    if (!Array.isArray(items)) return { progress: 0, max: 0 };
                    return items.reduce((acc, item) => {
                        acc.progress += Number(item.pointProgress || 0);
                        acc.max += Number(item.pointProgressMax || item.pointMax || 0);
                        return acc;
                    }, { progress: 0, max: 0 });
                };

                const pc = sumCounter(counters.pcSearch);
                if (pc.max === 0) return false;

                const balance = Number(userStatus.availablePoints || dashboard.availablePoints || 0);

                // 获取阅读进度
                let readProgress = 0, readMax = 30;
                try {
                    const readInfo = await API.getReadProgress();
                    if (readInfo) {
                        readProgress = readInfo.progress;
                        readMax = readInfo.max;
                    }
                } catch (e) { if (e?.code === "WEB_SESSION_STOPPED") throw e; }

                Utils.log("📊", `getuserinfo查询: PC ${pc.progress}/${pc.max}, 阅读 ${readProgress}/${readMax}, 积分 ${balance}`);

                return {
                    balance,
                    pc,
                    readProgress,
                    readMax,
                    dailyOffer: 0,
                    todayDetails: pc.max > 0 ? [{ title: "必应搜索", points: pc.progress, max: pc.max }] : [],
                    history: null
                };
            } catch (e) {
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                if (GM_getValue("Config.debugDAPI", false)) {
                    Utils.log("🟡", `getuserinfo 查询失败: ${e.message}`);
                }
                return false;
            }
        },

        // 查不到 counters 或配额 0/0 时返回 false，回退到 HTML 解析
        async getSearchQuotaFromAPI() {
            const region = Utils.isRegionLockEnabled() ? "cn" : RewardsAuto.state.region.toLowerCase();
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613",
                    headers: {
                        "content-type": "application/json; charset=UTF-8",
                        "user-agent": RewardsAuto.ua.app,
                        "authorization": `Bearer ${token}`,
                        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                        "x-rewards-ismobile": "true",
                        "x-rewards-country": region,
                        "x-rewards-language": "zh"
                    }
                }));
                if (Utils.isJSON(res)) {
                    const data = JSON.parse(res);
                    const response = data.response || {};
                    const promos = response.promotions || [];
                    if (GM_getValue("Config.debugDAPI", false)) {
                        const promoNames = promos.map(p => p.name || p.attributes?.offerid || "?").join(", ");
                        Utils.log("🔵", `DAPI promotions(${promos.length}): ${promoNames}`);

                        for (let i = 0; i < Math.min(promos.length, 5); i++) {
                            const p = promos[i];
                            const attrs = p.attributes || {};
                            const attrStr = Object.entries(attrs).map(([k, v]) => `${k}=${v}`).join(", ").slice(0, 300);
                            Utils.log("🔵", `DAPI promo[${i}] ${p.name}: ${attrStr}`);
                        }
                    }

                    const counters = response.counters || response.userStatus?.counters;
                    if (!counters) {
                        if (GM_getValue("Config.debugDAPI", false)) {
                            Utils.log("🟡", "DAPI 未返回 counters，回退到页面解析");
                        }
                        return false;
                    }

                    let pcCur = 0, pcMax = 0;
                    if (counters?.pcSearch && counters.pcSearch.length > 0) {
                        pcCur = counters.pcSearch[0].pointProgress || 0;
                        pcMax = counters.pcSearch[0].pointProgressMax || 0;
                    }

                    if (pcMax === 0) {
                        if (GM_getValue("Config.debugDAPI", false)) {
                            Utils.log("🟡", "DAPI 返回配额 0，回退到页面解析");
                        }
                        return false;
                    }

                    const balance = response.balance || response.userStatus?.availablePoints || 0;

                    // 获取阅读进度
                    let readProgress = 0, readMax = 30;
                    try {
                        const readInfo = await API.getReadProgress();
                        if (readInfo) {
                            readProgress = readInfo.progress;
                            readMax = readInfo.max;
                        }
                    } catch (e) { if (e?.code === "WEB_SESSION_STOPPED") throw e; }

                    Utils.log("📊", `DAPI查询: PC ${pcCur}/${pcMax}, 阅读 ${readProgress}/${readMax}, 积分 ${balance}`);

                    return {
                        balance,
                        pc: { progress: pcCur, max: pcMax },
                        readProgress,
                        readMax,
                        dailyOffer: 0,
                        todayDetails: [],
                        history: null
                    };
                }
            } catch (e) {
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                Utils.log("🟡", `DAPI查询失败: ${e.message}`);
            }
            return false;
        },

        // 查询当前积分余额
        async getBalance() {
            const region = Utils.isRegionLockEnabled() ? "cn" : RewardsAuto.state.region.toLowerCase();
            // 方法1: DAPI（需要 Token）
            try {
                const res = await this.withTokenRetry(token => Utils.xhr({
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=105",
                    headers: {
                        "content-type": "application/json; charset=UTF-8",
                        "user-agent": RewardsAuto.ua.app,
                        "authorization": `Bearer ${token}`,
                        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                        "x-rewards-ismobile": "true",
                        "x-rewards-country": region,
                        "x-rewards-language": "zh"
                    }
                }));
                if (Utils.isJSON(res)) {
                    const data = JSON.parse(res);
                    return data.response?.balance || 0;
                }
            } catch (e) { if (e.code === "WEB_SESSION_STOPPED") throw e; }

            // 方法2: getuserinfo API（不需要 Token）
            try {
                const data2 = await UserInfoSession.get();
                if (data2) {
                    const dashboard = data2.dashboard || data2;
                    return Number(dashboard.userStatus?.availablePoints ?? dashboard.availablePoints ?? data2.balance ?? 0);
                }
            } catch (e) { if (e.code === "WEB_SESSION_STOPPED") throw e; }

            return 0;
        },

        // 执行阅读
        async doRead() {
            const region = Utils.isRegionLockEnabled() ? "cn" : RewardsAuto.state.region.toLowerCase();
            try {
                const offerId = this._readOfferId || RewardsAuto.appConfig.offerIds.readArticle;
                // 生成 64 位 hex ID（无连字符），匹配实际 App 行为
                const id = Utils.getRandomUUID().replace(/-/g, '') + Utils.getRandomUUID().replace(/-/g, '').slice(0, 24);
                const res = await this.withTokenRetry(token => Utils.xhr({
                    method: "POST",
                    url: "https://prod.rewardsplatform.microsoft.com/dapi/me/activities",
                    headers: {
                        "content-type": "application/json; charset=utf-8",
                        "user-agent": RewardsAuto.ua.app,
                        "authorization": `Bearer ${token}`,
                        "x-rewards-appid": RewardsAuto.appConfig.rewardsAppId,
                        "x-rewards-ismobile": "true",
                        "x-rewards-country": region,
                        "x-rewards-language": "zh"
                    },
                    data: JSON.stringify({
                        amount: 1, country: region, id: id,
                        type: 101, attributes: { offerid: offerId }
                    })
                }));
                if (Utils.isJSON(res)) {
                    const data = JSON.parse(res);
                    if (data.error || data.success === false || data.response?.success === false) {
                        Utils.log("🟡", `阅读接口拒绝上报 (${offerId}): ${String(data.error || data.response?.message || "success=false").slice(0, 160)}`);
                        return null;
                    }
                    if (!data.response?.activity && !data.response?.isDuplicate) {
                        Utils.log("🟡", `阅读接口响应未确认成功 (${offerId}): ${String(res).slice(0, 240)}`);
                        return null;
                    }
                    const points = data.response?.activity?.p || 0;
                    const isDuplicate = data.response?.isDuplicate || false;
                    return { points, isDuplicate };
                }
                return null;
            } catch (e) {
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                Utils.log("🔴", `阅读请求失败: ${e.message}`);
                return false;
            }
        },

        // 只把服务器明确标记为锁定的卡片过滤掉；notsupported 不是锁定状态。
        cardLockReason(card) {
            const flag = value => value === true || value === "true" || value === 1 || value === "1"
                ? true : value === false || value === "false" || value === 0 || value === "0" ? false : null;
            const locked = flag(card.isLocked ?? card.locked);
            const unlocked = flag(card.isUnlocked);
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

        // 页面 RSC 数据优先于旧 getuserinfo 数据；按 offerId 合并，保留服务器完成状态。
        cardKey(card) {
            return String(card.offerId || "").trim().toLowerCase();
        },

        normalizeCard(item, source) {
            if (!item || typeof item !== "object") return null;
            const offerId = String(item.offerId || item.offerid || item.offer_id || item.id || item.name || "").trim();
            if (!offerId) return null;
            const flag = v => v === true || v === "true" || v === 1 || v === "1"
                ? true : v === false || v === "false" || v === 0 || v === "0" ? false : null;
            const done = [item.isCompleted, item.complete, item.completed].map(flag).find(v => v !== null);
            const max = Number(item.pointProgressMax || 0), progress = Number(item.pointProgress);
            const state = String(item.state || item.status || "").toLowerCase();
            const isCompleted = done === true || /^(completed|claimed)$/.test(state) || (max > 0 && progress >= max)
                ? true : done === false || (max > 0 && Number.isFinite(progress)) ? false : null;
            const title = String(item.title || item.name || item.description || "");
            const text = `${offerId} ${title}`;
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
                isPromotional: flag(item.isPromotional),
                type: Number.isInteger(item.type) ? item.type : 11,
                pageUrl: "https://rewards.bing.com/earn", destinationUrl
            };
        },

        pageCardData(html) {
            let text = String(html || "");
            const flight = [...text.matchAll(/self\.__next_f\.push\(\s*\[\s*1\s*,\s*("(?:\\.|[^"\\])*")\s*\]\s*\)/g)];
            if (flight.length) {
                text = flight.map(m => { try { return JSON.parse(m[1]); } catch (_) { return ""; } }).join("");
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
            // 旧页面仍可提供活动标识，但缺少完成字段时不能据此确认完成。
            if (!recognized) {
                for (const m of text.matchAll(/data-offer-id="([^"]+)"[^>]*data-hash="([^"]+)"/gi)) {
                    cards.push({ offerId: m[1], hash: m[2], points: 1 });
                }
                recognized = cards.length > 0;
            }
            return { cards, recognized };
        },

        extractCardAction(source) {
            // 必须同时匹配函数名，避免把领取余额等其他 Server Action 当成活动上报。
            const match = String(source || "").match(/\bcreateServerReference\s*\)?\s*\(\s*["']([a-f0-9]{40,})["'][^)]{0,500}?["']reportActivity["']\s*\)/i);
            return match ? match[1] : "";
        },

        async resolveCardAction(html) {
            const fallback = "707e6eb15bdfdd5fba193f0a77e934f7018faf87ce"; // 用户提供的 2026-09-19 官网代码。
            const clean = String(html || "").replace(/\\"/g, '"').replace(/&amp;|\\u0026/g, "&");
            const urls = [...new Set([...clean.matchAll(/\/_next\/static\/chunks\/[^"'<>\\\s]+?\.js(?:\?[^"'<>\\\s]*)?/g)].map(m =>
                new URL(m[0], "https://rewards.bing.com").href))];
            const key = urls.join("\n");
            if (this._cardActionKey === key && this._cardActionId) return this._cardActionId;
            this._cardActionKey = key;
            this._cardActionId = this.extractCardAction(clean);
            // 优先检查上次命中的资源和已核对的官网资源；文件名变化时继续检查本页依赖。
            urls.sort((a, b) => Number(b === this._cardActionAsset || b.includes("/3pg1ui3anrk2b.js"))
                - Number(a === this._cardActionAsset || a.includes("/3pg1ui3anrk2b.js")));
            for (let i = 0; !this._cardActionId && i < Math.min(urls.length, 48); i += 4) {
                const batch = await Promise.all(urls.slice(i, i + 4).map(async url => {
                    try { return { url, id: this.extractCardAction(await Utils.xhr({ url })) }; }
                    catch (_) {
                        if (_?.code === "WEB_SESSION_STOPPED") throw _;
                        return { url, id: "" };
                    }
                }));
                const found = batch.find(result => result.id);
                if (found) { this._cardActionId = found.id; this._cardActionAsset = found.url; }
            }
            if (this._cardActionId) {
                Utils.log("🟢", `动态 reportActivity: ${this._cardActionId.slice(0, 12)}…`);
            } else {
                this._cardActionId = fallback;
                Utils.log("🟡", "未识别到官网 reportActivity ID，使用 2026-09-19 已核对的备用值");
            }
            return this._cardActionId;
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
            // 只检查 RSC 根记录的 action 返回值，不扫描页面中无关的 success/isCompleted 字段。
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
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                if (!quiet) Utils.log("🟡", `getuserinfo 活动解析跳过: ${e.message}`);
            }
            // getuserinfo may restore an expired session; read /earn afterward so card hashes use that session.
            try {
                html = await Utils.xhr({ url: "https://rewards.bing.com/earn", headers: { "cache-control": "no-cache" } });
                const page = this.pageCardData(html);
                pageOk = page.recognized;
                for (const item of page.cards) merge(item, "page");
            } catch (e) {
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                if (!quiet) Utils.log("🟡", `活动页面获取失败: ${e.message}`);
            }
            const cards = [];
            for (const card of states.values()) {
                const lockReason = this.cardLockReason(card);
                if (lockReason) {
                    if (!quiet) Utils.log("🔒", `跳过卡片(${card.offerId}): ${lockReason}`);
                    continue;
                }
                if (card.isCompleted === true || !Number.isFinite(card.points) || card.points <= 0) continue;
                if (RewardsAuto.skipPatterns.some(pattern => `${card.offerId} ${card.title}`.toLowerCase().includes(pattern.toLowerCase()))) continue;
                cards.push(card);
            }
            this._lastCardScan = { ok: pageOk || userInfoOk, states, cards };
            if (!this._lastCardScan.ok && !quiet) Utils.log("🟡", "未取得可识别的活动数据，不能判断活动是否完成");
            if (cards.length && resolveAction) await this.resolveCardAction(html);
            return cards;
        },

        async claimCard(card, allowHashRetry = true) {
            const lockReason = this.cardLockReason(card);
            if (lockReason) {
                Utils.log("🔒", `跳过卡片(${card.offerId}): ${lockReason}`);
                return null;
            }
            if (card.isCompleted === true) return true;
            if (!card.offerId || !card.hash) {
                Utils.log("🟡", `卡片领取失败(${card.offerId || "未知活动"}): 缺少活动编号或 hash`);
                return false;
            }
            const nextAction = this._cardActionId || await this.resolveCardAction("");
            let result = null, error = "";
            try {
                const response = await Utils.xhr({
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
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                error = e.message;
            }
            // 和官网一样等待刷新；请求异常也先复查，避免未知结果触发重复提交。
            await Utils.delay(1000);
            await this.discoverCards({ quiet: true, resolveAction: false });
            const scan = this._lastCardScan;
            const completed = scan?.ok ? scan.states.get(this.cardKey(card))?.isCompleted : null;
            if (completed === true) {
                Utils.log("✅", `活动已由服务器确认完成: ${card.title || card.offerId}`);
                return true;
            }
            const refreshed = scan?.ok ? scan.states.get(this.cardKey(card)) : null;
            if (allowHashRetry && result === false && completed === false
                && refreshed && !this.cardLockReason(refreshed)
                && this.cardKey(refreshed) === this.cardKey(card)
                && refreshed.hash && refreshed.hash !== card.hash) {
                Utils.log("🔄", `卡片上报未成功且 hash 已刷新，补试一次(${card.offerId})`);
                return this.claimCard(refreshed, false);
            }
            const reason = error || (result === false ? "Server Action 返回未成功" : result === true ? "上报已接受" : "上报响应未确认");
            Utils.log("🟡", `卡片未确认(${card.offerId}): ${reason}；${completed === false ? "服务器仍显示未完成" : "无法确认服务器完成状态"}`);
            return false;
        },

        async getSearchPage(query, isMobile = false) {
            const mkt = Utils.isRegionLockEnabled() ? "&mkt=zh-CN" : "";
            const deviceType = isMobile ? "m" : "d";
            return Utils.xhr({
                url: `https://${RewardsAuto.state.host}/search?q=${encodeURIComponent(query)}&form=QBLH${mkt}`,
                headers: {
                    "user-agent": isMobile ? RewardsAuto.ua.mobile : RewardsAuto.ua.pc,
                    "cookie": `_Rwho=u=${deviceType}&ts=${RewardsAuto.state.dateNowStr}`,
                    "referer": `https://${RewardsAuto.state.host}/?form=QBLH`
                }
            });
        },

        async reportSearch(html, query, isMobile = false) {
            try {
                const ig = Utils.getRandomUUID();
                const mkt = Utils.isRegionLockEnabled() ? "&mkt=zh-CN" : "";
                const params = `q=${encodeURIComponent(query)}&form=QBLH${mkt}`;
                const deviceType = isMobile ? "m" : "d";
                const headers = {
                    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "user-agent": isMobile ? RewardsAuto.ua.mobile : RewardsAuto.ua.pc,
                    "referer": `https://${RewardsAuto.state.host}/?form=QBLH`,
                    "cookie": `_Rwho=u=${deviceType}&ts=${RewardsAuto.state.dateNowStr}`
                };

                await Utils.xhr({
                    method: "POST",
                    url: `https://${RewardsAuto.state.host}/rewardsapp/ncheader?ver=88888888&IID=SERP.5047&IG=${ig}&ajaxreq=1`,
                    headers,
                    data: "wb=1%3bi%3d1%3bv%3d1"
                });
                await Utils.xhr({
                    method: "POST",
                    url: `https://${RewardsAuto.state.host}/rewardsapp/reportActivity?IG=${ig}&IID=SERP.5047&${params}&ajaxreq=1`,
                    headers,
                    data: `url=${encodeURIComponent(`https://${RewardsAuto.state.host}/search?${params}`)}&V=web`
                });
                return true;
            } catch (e) {
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                Utils.log("🟡", `搜索上报失败: ${e.message}`);
                return false;
            }
        },

        async checkRegion(retryCount = 0) {
            if (!Utils.isRegionLockEnabled()) {
                Utils.log("🔓", "锁定国区已关闭：跳过地区检查，不强制国区参数");
                return true;
            }
            if (retryCount === 0) Utils.log("🔒", "锁定国区已开启：检查大陆 IP");
            try {
                const html = await Utils.xhr({ url: `https://${RewardsAuto.state.host}/` });
                if (!Utils.isRegionLockEnabled()) return true;
                if (!html) {
                    if (retryCount < 2) {
                        Utils.log("🟡", `地区检测返回空，第${retryCount + 1}次重试...`);
                        await Utils.randomDelay(3000, 8000);
                        return await this.checkRegion(retryCount + 1);
                    }
                    Utils.log("🔴", "地区检测失败（无响应）");
                    return false;
                }
                const match = html.replace(/\s/g, "").match(/Region:"(.*?)"(.*?)RevIpCC:"(.*?)"/);
                if (match) {
                    RewardsAuto.state.region = match[3].toUpperCase();
                    if (RewardsAuto.state.region !== "CN") {
                        await this.getIPInfo();
                        if (!Utils.isRegionLockEnabled()) return true;
                        Utils.notifyNonDomesticIp(`IP非大陆(${RewardsAuto.state.region})，已停止\n${RewardsAuto.state.ipInfo}`);
                        return false;
                    }
                    GM_setValue("Config.ipPauseNoticeDate", 0);
                    Utils.log("🟢", `地区检测通过: ${RewardsAuto.state.region}`);
                    return true;
                }
                // 正则未匹配到，可能是页面结构变化
                if (retryCount < 2) {
                    Utils.log("🟡", `地区检测格式异常，第${retryCount + 1}次重试...`);
                    await Utils.randomDelay(3000, 8000);
                    return await this.checkRegion(retryCount + 1);
                }
                Utils.log("🔴", "地区检测失败（格式不匹配）");
                return false;
            } catch (e) {
                if (e?.code === "WEB_SESSION_STOPPED") throw e;
                if (!Utils.isRegionLockEnabled()) return true;
                if (retryCount < 2) {
                    Utils.log("🟡", `地区检测异常: ${e.message}，第${retryCount + 1}次重试...`);
                    await Utils.randomDelay(3000, 8000);
                    return await this.checkRegion(retryCount + 1);
                }
                Utils.log("🔴", `地区检测失败: ${e.message}`);
                return false;
            }
        },

        async getIPInfo() {
            try {
                const qryResult = await Utils.xhr({
                    url: "https://disp-qryapi.3g.qq.com/v1/dispatch",
                    headers: { "referer": "https://3g.qq.com/" }
                });
                if (qryResult && Utils.isJSON(qryResult)) {
                    const resJSON = JSON.parse(qryResult);
                    RewardsAuto.state.ip = (resJSON.code == 0 && resJSON.extra && resJSON.extra.ip) ? resJSON.extra.ip : "";
                    let rawInfo = (resJSON.code == 0 && resJSON.ipInfo) ? String(resJSON.ipInfo) : "";
                    rawInfo = rawInfo.replace(/[#*]+/g, " ").trim();
                    RewardsAuto.state.ipInfo = rawInfo ? `🌏所在地区：${rawInfo}` : "";
                }
            } catch {
                console.debug("获取附加 IP 信息失败");
            }
        },

        async getHotSearchWord() {
            const keywords = ["天气预报", "今日新闻", "体育赛事", "股票行情", "电影推荐", "科技资讯", "美食食谱", "旅游攻略", "历史上的今天", "健康常识"];
            const baseWord = keywords[Utils.randomRange(0, keywords.length - 1)];
            const randomSuffix = Math.random().toString(36).slice(2, 6);
            let sentence = `${baseWord} ${randomSuffix}`;

            if (RewardsAuto.apiConfig.mode !== "offline") {
                if (RewardsAuto.apiConfig.wordIndex < 1 || RewardsAuto.apiConfig.wordList.length < 1) {
                    // 获取随机API配置
                    const apiArr = RewardsAuto.apiConfig.arr;
                    const lastApiIndex = parseInt(GM_getValue("Config.apiIndex", -1));
                    const candidates = apiArr
                        .map((entry, index) => ({ entry, index }))
                        .filter(item => item.index !== lastApiIndex);
                    const selected = candidates[Utils.randomRange(0, candidates.length - 1)];
                    GM_setValue("Config.apiIndex", selected.index);

                    const [apiName, apiConfig] = selected.entry;
                    RewardsAuto.apiConfig.url = apiConfig.url;
                    RewardsAuto.apiConfig.hot = apiConfig.hot;

                    try {
                        const hotSource = RewardsAuto.apiConfig.hot[Utils.randomRange(0, RewardsAuto.apiConfig.hot.length - 1)];
                        const result = await Utils.xhr({ url: RewardsAuto.apiConfig.url + hotSource });
                        if (result && Utils.isJSON(result)) {
                            const res = JSON.parse(result);
                            if (res.code == 200) {
                                RewardsAuto.apiConfig.wordIndex = 1;
                                RewardsAuto.apiConfig.wordList = [];
                                for (let i = 0; i < res.data.length; i++) {
                                    RewardsAuto.apiConfig.wordList.push(res.data[i].title);
                                }
                                // 随机打乱数组
                                RewardsAuto.apiConfig.wordList.sort(() => Math.random() - 0.5);
                                sentence = RewardsAuto.apiConfig.wordList[RewardsAuto.apiConfig.wordIndex];
                                // 截断到20-32字符
                                sentence = sentence.substring(0, Utils.randomRange(20, 32));
                                return sentence;
                            }
                        }
                    } catch (e) {
                        if (e?.code === "WEB_SESSION_STOPPED") throw e;
                        Utils.log("🟡", `热搜词获取失败: ${e.message}`);
                    }
                } else {
                    RewardsAuto.apiConfig.wordIndex++;
                    if (RewardsAuto.apiConfig.wordIndex > RewardsAuto.apiConfig.wordList.length - 1) {
                        RewardsAuto.apiConfig.wordIndex = 0;
                    }
                    sentence = RewardsAuto.apiConfig.wordList[RewardsAuto.apiConfig.wordIndex];
                    sentence = sentence.substring(0, Utils.randomRange(20, 32));
                    return sentence;
                }
                Utils.log("🟡", "热搜词接口异常，已使用随机搜索词");
            }
            return sentence;
        },

        async checkSearchRestricted() {
            // 用服务器实际进度判断，避免本地虚增导致误判
            const info = await this.getRewardsInfo();
            const currentTotal = info
                ? info.pc.progress
                : RewardsAuto.state.pcProgress;
            const lastTotal = RewardsAuto.state.lastSearchProgress;

            if (lastTotal !== -1) {
                if (currentTotal === lastTotal &&
                    currentTotal < RewardsAuto.state.pcMax) {
                    RewardsAuto.state.restrictedTimes++;
                } else {
                    RewardsAuto.state.restrictedTimes = 0;
                }
            }

            RewardsAuto.state.lastSearchProgress = currentTotal;
            GM_setValue("Config.lastSearchProgress", currentTotal);
            GM_setValue("Config.restrictedTimes", RewardsAuto.state.restrictedTimes);

            if (RewardsAuto.state.restrictedTimes >= 3) {
                Utils.log("🔴", "搜索受限或账号异常，已中断今日搜索！", true);
                return true;
            }
            return false;
        }
    };

    const isDashboardPage = typeof location !== "undefined" &&
        location.hostname === "rewards.bing.com" && /^\/dashboard\/?$/.test(location.pathname);

    // 每轮后台任务只打开一个 dashboard；该页面会统一处理每日活动和待领取积分。
    // 使用共享存储做跨标签页锁，避免每日活动新页面再次各自打开 dashboard。
    const dashboardLockKey = "Config.dashboardOpenLock";
    const dashboardLockTtl = 10 * 60 * 1000;
    const dashboardLockCooldown = 60 * 1000;
    let dashboardTabRequested = false;
    const makeDashboardLockId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const openDashboardOnce = async () => {
        await WebSession.ensure();
        if (dashboardTabRequested) {
            Utils.log("📅", "本轮已请求打开 dashboard，跳过重复打开");
            return false;
        }

        const now = Date.now();
        const currentLock = await GM_getValue(dashboardLockKey, null);
        if (currentLock && Number(currentLock.expiresAt) > now) {
            dashboardTabRequested = true;
            Utils.log("📅", "已有 dashboard 标签页正在处理，跳过重复打开");
            return false;
        }

        const lockId = makeDashboardLockId();
        dashboardTabRequested = true;
        await GM_setValue(dashboardLockKey, {
            id: lockId,
            createdAt: now,
            expiresAt: now + dashboardLockTtl
        });

        const confirmedLock = await GM_getValue(dashboardLockKey, null);
        if (!confirmedLock || confirmedLock.id !== lockId) {
            Utils.log("📅", "其他页面已取得 dashboard 锁，跳过重复打开");
            return false;
        }

        try {
            await WebSession.ensure();
            await GM_openInTab(`https://rewards.bing.com/dashboard?ref=rewardspanel#rauto=${encodeURIComponent(lockId)}`, {
                active: false,
                insert: true
            });
            return true;
        } catch (e) {
            dashboardTabRequested = false;
            const latestLock = await GM_getValue(dashboardLockKey, null);
            if (latestLock?.id === lockId) await GM_setValue(dashboardLockKey, null);
            throw e;
        }
    };

    const TaskManager = {
        // 任务日期状态
        signDate: 0, readDate: 0, promosDate: 0, searchDate: 0, streakDays: 0,
        signPoint: -1, signTimes: 0, readTimes: 0, promosTimes: 0,
        cardAttempted: new Set(), cardResults: new Map(),

        // 初始化任务状态
        init() {
            RewardsAuto.state.dateNowNum = Utils.getTodayNum();
            RewardsAuto.state.dateNowStr = Utils.getTodayStr();
            RewardsAuto.state.readProgress = 0;
            RewardsAuto.state.readMax = 30;
            const tasks = GM_getValue("Config.tasks", {});
            this.signDate = tasks.sign || 0;
            this.readDate = tasks.read || 0;
            // 旧版本即使全部领取失败也会写入完成日期，升级后必须重新验证。
            this.promosDate = tasks.promosSchema === 1 ? tasks.promos || 0 : 0;
            this.searchDate = tasks.search || 0;
            this.streakDays = tasks.streakDays || 0;
            this.signPoint = GM_getValue("Config.signPoint", -1);
        },

        // 保存任务状态
        save() {
            WebSession.assertActive();
            GM_setValue("Config.tasks", {
                sign: this.signDate, read: this.readDate,
                promos: this.promosDate, search: this.searchDate,
                promosSchema: 1,
                streakDays: this.streakDays
            });
        },

        async doSign() {
            if (!GM_getValue("Tasks.sign", true) || this.signTimes > 2) return;
            if (this.signPoint >= 0 && this.signDate === RewardsAuto.state.dateNowNum) {
                Utils.log("✅", `签入已完成(${this.signPoint}积分)`);
                return;
            }

            await Utils.randomDelay();
            
            let totalPoint = 0;
            let signOk = false;
            
            // App 端签到（静默执行，不写入通知）
            const appPoint = await API.signApp();
            if (appPoint >= 0) {
                signOk = true;
                if (appPoint > 0) {
                    GM_log(`📱 App签入静默成功 +${appPoint}积分`);
                    totalPoint += appPoint;
                } else {
                    GM_log("📱 App签入已确认，无新增积分");
                }
            }
            
            // PC 端签到
            await Utils.randomDelay(3000, 8000);
            const pcPoint = await API.signPC();
            if (pcPoint >= 0) {
                signOk = true;
                Utils.log("💻", `PC签入成功！+${pcPoint}积分`);
                totalPoint += pcPoint;
            }
            
            if (signOk) {
                this.signPoint = totalPoint;
                this.signDate = RewardsAuto.state.dateNowNum;
                GM_setValue("Config.signPoint", totalPoint);
                this.save();
                Utils.log("🔵", `签入任务完成！总积分 +${totalPoint}`, true);
            } else {
                this.signTimes++;
                Utils.log("🟡", `签入失败，稍后重试`);
            }
        },

        async doRead() {
            if (!GM_getValue("Tasks.read", true) || this.readTimes > 2) return;
            if (this.readDate === RewardsAuto.state.dateNowNum) {
                // 二次验证：检查实际进度是否真的满了
                const verifyProgress = await API.getReadProgress();
                if (verifyProgress && verifyProgress.progress >= verifyProgress.max) {
                    Utils.log("✅", `阅读任务已完成（已验证 ${verifyProgress.progress}/${verifyProgress.max}）`);
                    return;
                } else if (verifyProgress) {
                    // readDate 被错误设置，重置
                    Utils.log("🟡", `阅读标记有误（${verifyProgress.progress}/${verifyProgress.max}），重置并继续`);
                    this.readDate = 0;
                    this.save();
                } else {
                    Utils.log("🟡", "无法验证阅读进度，跳过");
                    return;
                }
            }

            const progress = await API.getReadProgress();
            if (!progress) {
                this.readTimes++;
                Utils.log("🟡", "无法获取阅读进度，稍后重试");
                return;
            }

            const { progress: cur, max } = progress;
            Utils.log("📖", `阅读进度: ${cur}/${max}`);

            if (cur >= max) {
                this.readDate = RewardsAuto.state.dateNowNum;
                this.save();
                Utils.log("✅", "阅读任务已完成");
                return;
            }

            let successCount = 0;
            const maxPerDay = 10; // 每天最多 10 篇
            const remaining = Math.min(max - cur, maxPerDay);
            Utils.log("📖", `今日还可阅读 ${remaining} 篇（上限 ${maxPerDay} 篇/天）`);

            for (let i = 0; i < remaining; i++) {
                const result = await API.doRead();
                if (!result) { Utils.log("🟡", `阅读第 ${i + 1} 篇失败，中止`); break; }
                successCount++;
                Utils.log("📖", `阅读文章 ${i + 1}/${remaining} +${result.points}积分`);
                await Utils.randomDelay(3000, 8000);
            }

            if (successCount === 0) {
                this.readTimes++;
                Utils.log("🟡", "阅读全部失败，稍后重试");
                return;
            }

            // 二次验证
            const verify = await API.getReadProgress();
            if (verify && verify.progress >= verify.max) {
                this.readDate = RewardsAuto.state.dateNowNum;
                this.save();
                Utils.log("🔵", `阅读任务完成！共 ${successCount} 篇`, true);
            } else {
                this.readTimes++;
                Utils.log("🟡", `阅读已执行但未完成，下次继续`);
            }
        },

        async doPromos(secondScan = false) {
            if (!GM_getValue("Tasks.promos", true)) return;
            Utils.log(secondScan ? "🔄" : "🧩", secondScan ? "二次扫描：检查是否有新解锁的卡片..." : "扫描活动卡片...");
            const cards = await API.discoverCards();
            if (!API._lastCardScan?.ok) {
                this.promosDate = 0;
                this.save();
                Utils.log("🟡", "活动状态查询失败，保留未完成状态");
                return;
            }
            const enabled = card => card.kind !== "quiz" || GM_getValue("Tasks.quiz", true);
            const pending = cards.filter(enabled);
            const fresh = pending.filter(card => !this.cardAttempted.has(API.cardKey(card)));
            Utils.log("🧩", secondScan
                ? `二次扫描：${fresh.length} 个新卡片，${pending.length - fresh.length} 个本轮已尝试`
                : `发现 ${pending.length} 个待完成卡片（已按活动编号去重）`);
            for (const card of fresh) {
                const key = API.cardKey(card);
                this.cardAttempted.add(key);
                this.cardResults.set(key, false);
                Utils.log("  ", `[${card.kind}] ${card.title} +${card.points}p`);
                await Utils.randomDelay(3000, 8000);
                this.cardResults.set(key, await API.claimCard(card) === true);
            }
            // 再看一次服务器状态，包含延迟入账及已尝试后在页面手动完成的活动。
            const remaining = fresh.length ? await API.discoverCards({ quiet: true, resolveAction: false }) : cards;
            const scan = API._lastCardScan;
            if (scan?.ok) {
                for (const key of this.cardResults.keys()) {
                    const completed = scan.states.get(key)?.isCompleted;
                    if (typeof completed === "boolean") this.cardResults.set(key, completed);
                }
            }
            const ok = [...this.cardResults.values()].filter(Boolean).length;
            const unconfirmed = this.cardResults.size - ok;
            const count = remaining.filter(enabled).length;
            this.promosDate = scan?.ok && count === 0 && unconfirmed === 0 ? RewardsAuto.state.dateNowNum : 0;
            this.save();
            Utils.log(this.promosDate ? "✅" : "🟡", this.promosDate
                ? `活动卡片已验证完成，本轮 ${ok} 个已确认`
                : `活动卡片尚未完成：本轮 ${ok} 个已确认/${unconfirmed} 个未确认；${scan?.ok ? `服务器还有 ${count} 个待完成` : "最终状态查询失败"}`, !secondScan);
        },

        async doSearch() {
            if (!GM_getValue("Tasks.search", true)) return;

            const info = await API.getRewardsInfo();
            if (!info) { Utils.log("🔴", "无法获取积分信息"); return; }

            RewardsAuto.state.pcProgress = info.pc.progress;
            RewardsAuto.state.pcMax = info.pc.max;

            Utils.log("🔍", `搜索配额: PC ${info.pc.progress}/${info.pc.max}`);

            const pcDone = info.pc.progress >= info.pc.max;
            if (pcDone) {
                this.searchDate = RewardsAuto.state.dateNowNum;
                this.save();
                Utils.log("✅", `搜索配额已满 PC: ${info.pc.progress}/${info.pc.max}`);
                return;
            }

            if (this.searchDate === RewardsAuto.state.dateNowNum) {
                Utils.log("🟡", "搜索配额未满，继续执行搜索任务");
                this.searchDate = 0;
            }

            const isRestricted = await API.checkSearchRestricted();
            if (isRestricted) {
                this.searchDate = RewardsAuto.state.dateNowNum;
                this.save();
                return;
            }

            const limit = Utils.randomRange(4, 7);
            for (let i = 0; i < limit; i++) {
                if (RewardsAuto.state.pcProgress >= RewardsAuto.state.pcMax) break;

                let query;
                if (RewardsAuto.apiConfig.mode !== "offline") {
                    query = await API.getHotSearchWord();
                } else {
                    query = RewardsAuto.searchPool[Utils.randomRange(0, RewardsAuto.searchPool.length - 1)];
                }

                Utils.log("🔍", `[PC] 搜索 ${i+1}/${limit}: ${query}`);

                try {
                    const html = await API.getSearchPage(query, false);
                    if (html) {
                        await API.reportSearch(html, query, false);
                        RewardsAuto.state.pcProgress += 3;
                    }
                } catch (e) {
                    Utils.log("🟡", `搜索失败: ${e.message}`);
                }

                const span = Number(GM_getValue("Config.span", 30));
                const wait = Utils.randomRange((span-15)*1000, (span+15)*1000);
                Utils.log("⏳", `等待 ${wait/1000}秒`);
                await Utils.delay(wait);
            }

            const finalInfo = await API.getRewardsInfo();
            if (finalInfo) {
                const pcDone2 = finalInfo.pc.progress >= finalInfo.pc.max;
                if (pcDone2) {
                    this.searchDate = RewardsAuto.state.dateNowNum;
                    this.save();
                    RewardsAuto.state.restrictedTimes = 0;
                    GM_setValue("Config.restrictedTimes", 0);
                    GM_setValue("Config.lastSearchProgress", -1);
                    Utils.log("🔵", `🔍 搜索任务完成！PC: ${finalInfo.pc.progress}/${finalInfo.pc.max}`, true);
                } else {
                    Utils.log("🟡", `搜索已执行，配额未满 PC: ${finalInfo.pc.progress}/${finalInfo.pc.max}`);
                }
            } else {
                Utils.log("🟡", "搜索已执行，但无法获取最终配额状态");
            }
        },

        async doDailySet() {
            await WebSession.ensure();
            const today = Utils.getTodayNum();
            const completedKey = "Config.dailySetCompleted";
            if (GM_getValue(completedKey, 0) === today) {
                Utils.log("✅", "每日活动今日已完成，跳过打开 dashboard");
                return;
            }

            const processedKey = "Config.dailySetProcessed";
            let processed = GM_getValue(processedKey, []);
            if (processed.length > 0 && processed[0]?.date !== today) processed = [];
            const processedIds = new Set(processed.map(p => p.offerId));

            Utils.log("📅", `开始执行每日活动（已处理 ${processedIds.size} 个）...`);
            await Utils.randomDelay(3000, 8000);

            // 检测运行环境：前台页面直接 DOM 操作，后台通过 GM_openInTab。
            const currentHostname = typeof location === "undefined" ? "" : location.hostname;
            const hasDocumentBody = typeof document !== "undefined" && !!document.body;
            const isBingPage = /^(www|cn)\.bing\.com$/i.test(currentHostname);
            const isServiceWorker = !hasDocumentBody || (currentHostname !== "rewards.bing.com" && !isBingPage);
            Utils.log("📅", `运行环境检测: ${isServiceWorker ? "service worker" : "页面上下文"} (hostname: ${currentHostname || "undefined"})`);

            if (isBingPage && hasDocumentBody) {
                const dailyLinks = this.dailySetLinks();
                const incompleteLinks = this.dailySetLinks(true);

                if (dailyLinks.length > 0 && incompleteLinks.length === 0) {
                    GM_setValue(completedKey, today);
                    Utils.log("✅", "Bing 奖励面板中的每日活动均已完成");
                    return;
                }

                if (incompleteLinks.length > 0) {
                    Utils.log("📅", `Bing 页面发现 ${incompleteLinks.length} 个未完成的每日活动，尝试就地处理...`);
                    try {
                        const directProcessedIds = new Set(processedIds);
                        const clickedCount = await this.clickDailySetLinks(directProcessedIds);
                        WebSession.assertActive();
                        const remainingLinks = this.dailySetLinks(true);
                        if (clickedCount > 0 && remainingLinks.length === 0) {
                            GM_setValue(completedKey, today);
                            Utils.log("✅", `Bing 页面已确认每日活动完成（点击 ${clickedCount} 项）`, true);
                            return;
                        }
                        Utils.log("🟡", `Bing 页面未能确认每日活动完成（点击 ${clickedCount} 项，仍有 ${remainingLinks.length} 项未完成）`);
                    } catch (e) {
                        Utils.log("🟡", `Bing 页面处理每日活动失败: ${e.message}`);
                    }
                } else {
                    Utils.log("📅", "Bing 页面未发现可识别的 rnoreward=1 活动链接");
                }

                const dashboardRequest = await this._clickDailySetViaForeground(processedIds);
                if (dashboardRequest?.opened) {
                    Utils.log("🔵", "Bing 页面处理未确认，已启动原 Dashboard 兜底", true);
                } else if (dashboardRequest?.active) {
                    Utils.log("📅", "Bing 页面处理未确认，已有 Dashboard 标签页兜底处理");
                } else {
                    Utils.log("🟡", "Bing 页面与 Dashboard 兜底均未能启动");
                }
                return;
            }

            if (isServiceWorker) {
                // 后台模式：通过打开链接执行
                Utils.log("📅", "后台模式：打开每日活动链接...");
                const dashboardRequest = await this._clickDailySetViaForeground(processedIds);
                if (dashboardRequest?.opened) {
                    Utils.log("🔵", "已请求打开一个后台 dashboard，等待页面完成每日活动", true);
                } else if (dashboardRequest?.active) {
                    Utils.log("📅", "已有 dashboard 标签页正在处理每日活动，当前页面不重复打开");
                } else {
                    Utils.log("🟡", "未能请求打开每日活动页面");
                }
            } else {
                // 前台模式：直接 DOM 操作
                try {
                    const clickedCount = await this.clickDailySetLinks(processedIds);
                    WebSession.assertActive();
                    if (clickedCount > 0) {
                        // 保存处理记录
                        const newProcessed = [...processedIds].map(id => ({ date: today, offerId: id }));
                        GM_setValue(processedKey, newProcessed);
                        Utils.log("🔵", `每日活动完成，点击了 ${clickedCount} 个活动`, true);
                    } else {
                        Utils.log("🟡", "未找到可点击的每日活动链接");
                    }
                } catch (e) {
                    Utils.log("🔴", `每日活动执行异常: ${e.message}`);
                }
            }
        },

        async doClaimPoints() {
            await WebSession.ensure();
            // 通过 XHR 检测可领取积分（兼容 service worker）
            try {
                const dashboardHtml = await Utils.xhr({ url: "https://rewards.bing.com/dashboard" });
                if (!dashboardHtml) {
                    Utils.log("✅", "无法获取 dashboard 页面");
                    return;
                }

                const claimableMatch = dashboardHtml.match(/alt="可领取"[^>]*>[\s\S]*?(\d[\d,]*)/i);
                if (!claimableMatch) {
                    Utils.log("✅", "无可领取积分");
                    return;
                }

                const amount = parseInt(claimableMatch[1].replace(/,/g, '')) || 0;
                if (amount > 0) {
                    Utils.log("🎁", `发现 ${amount} 积分待领取，尝试自动领取...`);
                    await this._claimPointsViaForeground();
                } else {
                    Utils.log("✅", "可领取积分为 0");
                }
            } catch (e) {
                Utils.log("🟡", `检测可领取积分失败: ${e.message}`);
            }
        },

        // 直接打开 dashboard 页面领取积分（service worker 调用）
        async _claimPointsViaForeground() {
            if (isDashboardPage) {
                Utils.log("📅", "当前已在 dashboard 页面，跳过重复打开");
                return;
            }

            Utils.log("📅", "打开 dashboard 页面领取积分...");
            // dashboard 页面会统一自动处理领取和每日活动。
            const opened = await openDashboardOnce();
            Utils.log("🎁", opened ? "已打开 dashboard 页面，等待领取积分..." : "已复用 dashboard 页面，等待领取积分...");
        },

        // 只读取 Next.js 下发的真实任务模型，避免把公共翻译文案当成账号任务。
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

            const flight = [...String(html || "").matchAll(
                /self\.__next_f\.push\(\s*\[\s*1\s*,\s*("(?:\\.|[^"\\])*")\s*\]\s*\)/g
            )].map(match => {
                try { return JSON.parse(match[1]); } catch (_) { return ""; }
            }).join("");

            for (const line of flight.split("\n")) {
                const record = line.match(/^[a-f0-9]+:(.*)$/i);
                if (!record) continue;
                try { visit(JSON.parse(record[1])); } catch (_) {}
            }
            return { tasks: [...tasks.values()], bonus };
        },

        // ====== 连签任务检测（通过 XHR 获取 earn 页面信息） ======
        async doStreak() {
            Utils.log("📅", "开始检测连签任务...");
            try {
                const earnHtml = await Utils.xhr({ url: "https://rewards.bing.com/earn" });
                if (!earnHtml) { Utils.log("🟡", "无法获取 earn 页面"); return; }

                const { tasks, bonus } = this.parseStreakData(earnHtml);
                if (!tasks.length) {
                    Utils.log("🟡", "未取得可识别的连签任务数据，跳过视觉搜索开页");
                    return;
                }

                const taskMeta = {
                    bing: { name: "必应搜索连续打卡" },
                    dailyset: { name: "每日连续打卡活动" },
                    bingapp: { name: "必应应用连续打卡" },
                    visualsearch: { name: "视觉搜索连续打卡" }
                };
                const isDone = task => task.isCurrentDayCompleted === true ||
                    (task.activitiesTotal > 0 && task.activitiesCompleted >= task.activitiesTotal);

                for (const task of tasks) {
                    if (!task.isEnabled) continue;
                    const meta = taskMeta[task.partner] || { name: task.title || task.partner };
                    const done = isDone(task);
                    Utils.log(done ? "✅" : "📅",
                        `${meta.name}: ${task.activitiesCompleted}/${task.activitiesTotal}${done ? " 已完成" : ""}`);
                    if (task.partner === "dailyset" && Number.isFinite(task.completedDays)) {
                        this.streakDays = task.completedDays;
                        Utils.log("📅", `每日连续打卡：${this.streakDays} 天`);
                    }
                }

                const visualSearch = tasks.find(task => task.partner === "visualsearch" && task.isEnabled);
                if (!visualSearch) {
                    Utils.log("📅", "当前未下发视觉搜索连续打卡任务，跳过自动打开");
                } else if (!isDone(visualSearch)) {
                    Utils.log("📅", "视觉搜索未完成，正在自动打卡...");
                    const attemptKey = "Config.visualSearchAttempt";
                    const today = RewardsAuto.state.dateNowNum || Utils.getTodayNum();
                    const previous = await GM_getValue(attemptKey, null);
                    if (Number(previous?.date) === today) {
                        Utils.log("📅", "今日已尝试视觉搜索打卡，跳过重复打开");
                        return;
                    }

                    const attempt = { date: today, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
                    await GM_setValue(attemptKey, attempt);
                    const confirmed = await GM_getValue(attemptKey, null);
                    if (confirmed?.id !== attempt.id) {
                        Utils.log("📅", "其他页面已处理视觉搜索打卡，跳过重复打开");
                        return;
                    }
                    let opened = false;
                    try {
                        const vsUrl = "https://www.bing.com/?features=vsstreak,vstooltip&form=ML2XES";
                        await WebSession.ensure();
                        await GM_openInTab(vsUrl, { active: false, insert: true });
                        opened = true;
                        Utils.log("✅", "视觉搜索打卡页面已打开");
                        await Utils.randomDelay(3000, 5000);
                    } catch (e) {
                        const latest = await GM_getValue(attemptKey, null);
                        if (latest?.id === attempt.id) await GM_setValue(attemptKey, null);
                        Utils.log("🟡", `视觉搜索打卡失败: ${e.message}`);
                    }

                    if (opened) {
                        try {
                            const refreshedHtml = await Utils.xhr({
                                url: "https://rewards.bing.com/earn",
                                headers: { "cache-control": "no-cache" }
                            });
                            const refreshed = this.parseStreakData(refreshedHtml).tasks
                                .find(task => task.partner === "visualsearch" && task.isEnabled);
                            Utils.log(refreshed && isDone(refreshed) ? "✅" : "🟡",
                                refreshed && isDone(refreshed)
                                    ? "视觉搜索打卡已由服务端确认"
                                    : "视觉搜索打卡尚未由服务端确认，今日不再重复打开");
                        } catch (e) {
                            Utils.log("🟡", `视觉搜索状态复查失败: ${e.message}`);
                        }
                    }
                }

                if (bonus) Utils.log("📅", `连签奖励印章进度: ${bonus.progress}/${bonus.total}`);

                Utils.log("📅", "连签任务检测完成");
            } catch (e) {
                Utils.log("🔴", `连签任务异常: ${e.message}`);
            }
        },

        // 通过打开链接完成每日活动（后台模式）
        async _clickDailySetViaForeground(processedIds) {
            try {
                // dashboard 页面会统一自动处理每日活动和待领取积分。
                const opened = await openDashboardOnce();
                Utils.log("📅", opened ? "已打开 dashboard 页面，等待自动点击每日活动..." : "已复用 dashboard 页面，等待自动点击每日活动...");
                return { opened, active: dashboardTabRequested };
            } catch (e) {
                Utils.log("🟡", `活动执行失败: ${e.message}`);
                return { opened: false, active: false };
            }
        },

        dailySetLinks(incompleteOnly = false) {
            if (typeof document === "undefined") return [];
            return Array.from(document.querySelectorAll('a[href*="rnoreward=1"]'))
                .filter(link => !new URL(link.href, location.href).pathname.startsWith("/redeem"))
                .filter(link => !incompleteOnly || !/已完成|Completed/i.test(link.textContent || ""));
        },

        async clickDailySetLinks(processedIds) {
            // DOM 方式点击每日活动链接（在页面上下文中执行）
            let clickCount = 0;

            // 等待每日活动区域加载
            try {
                await Utils.waitForElement('a[href*="rnoreward=1"]', 15000);
            } catch {
                Utils.log("🟡", "等待活动链接超时，页面可能未加载完成");
            }

            // 选择器：匹配每日活动链接（包含 rnoreward=1 参数）
            const allLinks = this.dailySetLinks();
            Utils.log("📅", `找到 ${allLinks.length} 个每日活动链接`);

            for (const link of allLinks) {
                const href = link.href || "";
                const text = link.textContent || "";

                // 检测已完成：文本包含"已完成"或点数后无"+"
                if (text.includes("已完成") || text.includes("Completed")) {
                    Utils.log("📅", `跳过已完成活动`);
                    continue;
                }

                // 提取活动标题（第一个段落文本）
                const titleEl = link.querySelector('p');
                const title = titleEl ? titleEl.textContent.trim().substring(0, 30) : "未知活动";

                // 提取 offerId 用于去重
                const offerIdMatch = href.match(/BTDSUOID[^"]*?(\w+_\d{8}_Child\d+)/i);
                const offerId = offerIdMatch ? offerIdMatch[1] : href.slice(0, 80);
                if (processedIds.has(offerId)) continue;

                Utils.log("📅", `点击活动: ${title}`);
                await Utils.randomDelay(3000, 8000);

                try {
                    // 点击链接（会在新标签页打开）
                    await WebSession.ensure();
                    link.click();
                    clickCount++;
                    processedIds.add(offerId);
                    await Utils.randomDelay(3000, 8000);
                } catch (e) {
                    Utils.log("🟡", `点击活动失败: ${e.message}`);
                }
            }
            return clickCount;
        },

        async runAll() {
            if (this.running) {
                Utils.log("🟡", "任务正在运行中，请勿重复触发");
                return;
            }
            this.running = true;
            try {
            await WebSession.ensure();
            UserInfoSession.beginRun();
            RewardsAuto.state.startTime = Utils.getTimestamp();
            Utils.log("🚀", "启动全能自动化任务...");
            this.init();
            this.cardAttempted.clear();
            this.cardResults.clear();
            API._cardActionKey = null;
            API._cardActionId = "";

            const regionOK = await API.checkRegion();
            
            // Token 续期
            let isTokenOK = false;
            if (regionOK) {
                isTokenOK = await API.renewToken();
                if (!isTokenOK) {
                    Utils.log("🟡", "Token失败，跳过签入/阅读", true);
                }
            } else {
                // checkRegion 已分别记录地区异常或发送非大陆 IP 通知。
                return;
            }

            // Token 续期后记录初始积分；失败时 getBalance() 仍会回退到 getuserinfo。
            const startBalance = await API.getBalance();
            Utils.log("📊", `初始积分: ${startBalance}`);

            // setTimeout 重试机制
            const retryDelay = 60000; // 重试间隔 60 秒
            const maxRetries = 2;

            const withRetry = async (taskFn, taskName, retries = 0) => {
                try {
                    await WebSession.ensure();
                    const result = await taskFn();
                    WebSession.assertActive();
                    if (result === false && retries < maxRetries) {
                        Utils.log("🟡", `${taskName} 失败，${retryDelay/1000}秒后重试 (${retries + 1}/${maxRetries})`);
                        await Utils.delay(retryDelay);
                        return withRetry(taskFn, taskName, retries + 1);
                    }
                    return result;
                } catch (e) {
                    if (e.code === "WEB_SESSION_STOPPED" || WebSession.isStopped()) throw WebSession.error();
                    if (retries < maxRetries) {
                        Utils.log("🟡", `${taskName} 异常: ${e.message}，${retryDelay/1000}秒后重试`);
                        await Utils.delay(retryDelay);
                        return withRetry(taskFn, taskName, retries + 1);
                    }
                    Utils.log("🔴", `${taskName} 失败: ${e.message}`);
                    return false;
                }
            };

            if (regionOK && isTokenOK) {
                await withRetry(() => this.doSign(), "签到");
                await Utils.randomDelay();
                if (!RewardsAuto.state.pc401) {
                    await withRetry(() => this.doRead(), "阅读");
                    await Utils.randomDelay();
                } else {
                    Utils.log("🟡", "PC会话已过期，跳过阅读任务");
                }
            } else if (regionOK) {
                await withRetry(() => this.doSign(), "签到");
                await Utils.randomDelay();
            }

            await withRetry(() => this.doPromos(), "活动卡片");
            await Utils.randomDelay();

            await withRetry(() => this.doSearch(), "搜索");

            // 连签任务检测
            await withRetry(() => this.doStreak(), "连签检测");
            await Utils.randomDelay();

            Utils.log("📅", "开始执行每日活动任务...");
            await Utils.randomDelay();
            await withRetry(() => this.doDailySet(), "每日活动");

            // 领取待领取积分
            try {
                await this.doClaimPoints();
            } catch (e) {
                Utils.log("🟡", `领取积分执行异常: ${e.message}`);
            }

            if (GM_getValue("Tasks.promos", true)) {
                await Utils.randomDelay(3000, 8000);
                await this.doPromos(true);
            }

            // 任务完成汇总
            const endTime = Utils.getTimestamp();
            const totalTime = ((endTime - RewardsAuto.state.startTime) / 1000).toFixed(1);

            // 查询最终积分
            const endBalance = await API.getBalance();
            const earned = (startBalance > 0 && endBalance > 0) ? (endBalance - startBalance) : 0;

            const info = await API.getRewardsInfo();
            await WebSession.ensure();
            if (info) {
                // 构建简洁日志
                const signOk = this.signDate === RewardsAuto.state.dateNowNum;
                const readOk = this.readDate === RewardsAuto.state.dateNowNum;
                const searchOk = info.pc.progress >= info.pc.max;
                const promosOk = this.promosDate === RewardsAuto.state.dateNowNum;
                const readProgress = Number.isFinite(info.readProgress)
                    ? info.readProgress : RewardsAuto.state.readProgress;
                const readMax = Number.isFinite(info.readMax) && info.readMax > 0
                    ? info.readMax : RewardsAuto.state.readMax;

                let logMsg = `签到\t\t${signOk ? '✅' : '❌'}\n`;
                logMsg += `阅读\t\t${readOk ? '✅' : '❌'} ${readProgress}/${readMax}\n`;
                logMsg += `PC 搜索\t${searchOk ? '✅' : '⏳'} ${info.pc.progress}/${info.pc.max}\n`;
                logMsg += `活动卡片\t${!GM_getValue("Tasks.promos", true) ? '已关闭' : promosOk ? '✅' : '⏳ 未完成/待确认'}\n`;
                logMsg += `连签\t\t${this.streakDays || 0} 天\n`;
                logMsg += `今日获取\t+${earned}\n`;
                logMsg += `总积分\t\t${info.balance || endBalance}`;

                // 发送通知
                RewardsAuto.state.sendMSG = logMsg;
                Utils.log("📊", logMsg, true);
            } else {
                Utils.log("🎉", `任务执行完成！用时 ${totalTime} 秒`, true);
            }
            } catch (e) {
                if (e.code !== "WEB_SESSION_STOPPED" && !WebSession.isStopped()) Utils.log("🔴", `任务执行异常: ${e.message}`);
            } finally {
                this.running = false;
            }
        }
    };

    // 捕获手动退出，立即通知其他脚本实例停止；不阻止网站本身的退出操作。
    if (typeof document !== "undefined") document.addEventListener("click", event => {
        const control = event.target?.closest?.('a, button, [role="button"], [role="menuitem"]');
        if (!control) return;
        const label = String(control.getAttribute("aria-label") || control.textContent || "").trim();
        let logoutLink = false;
        try {
            const url = new URL(control.getAttribute("href"), location.href);
            logoutLink = ["login.live.com", "account.live.com", "rewards.bing.com", "www.bing.com", "cn.bing.com", "bing.com"].includes(url.hostname)
                && /\/(?:signout|logout)(?:[/.]|$)/i.test(url.pathname);
        } catch (_) {}
        const accountMenu = control.closest?.('#id_d, #id_l, #mectrl_main, [id^="mectrl_"]');
        if (logoutLink || /^(?:退出登录|退出登入|退出登錄|登出|注销|註銷|sign\s*out|log\s*out)$/i.test(label)
            || accountMenu && label === "退出") {
            WebSession.stop("已手动退出网页登录", true);
        }
    }, true);

    // 兑换页包含与任务页相似的链接；在此页运行自动点击会反复打开兑换窗口。
    const isRedeemPage = location.hostname === "rewards.bing.com" && location.pathname.startsWith("/redeem");

    if (location.hostname === "rewards.bing.com" && !isRedeemPage && !isDashboardPage) {
        const punchCardSelectors = [
            "a[href*='punchcard']", "a[href*='quest']",
            "a[data-rac][href*='earn']", "a.cursor-pointer[href]",
            "a.group\\/ctrl",
            "a[href*='/earn/quest/']",
            "a[href*='promotional']",
            "a[data-bi-id][href*='earn']",
        ];
        const textPatterns = ["盗贼之海", "五月亮点来袭", "每日活动", "Daily Set", "限时活动", "特别活动"];
        
        const detailTextPatterns = [
            "关注赛事", "访问网站", "开始搜索",
            "发现", "探索", "获取", "Learn more", "了解更多",
            "Start", "Begin", "Watch", "View", "Check",
            "立即开始", "立即参与", "立即前往", "立即访问",
            "参加活动", "参与活动", "前往活动"
        ];

        const clickDetailTasks = async () => {
            const today = Utils.getTodayNum();
            const detailStateKey = "Config.punchCardDetailState";
            const detailDateKey = "Config.punchCardDetailDate";
            const savedDate = GM_getValue(detailDateKey, 0);
            let currentDetailState = 0;
            
            if (savedDate === today) {
                currentDetailState = GM_getValue(detailStateKey, 0);
            } else {
                GM_setValue(detailStateKey, 0);
                GM_setValue(detailDateKey, today);
            }
            
            if (currentDetailState >= 5) {
                console.log("[Rewards Auto] 详情页任务今日已全部点击完成");
                return true;
            }
            
            console.log(`[Rewards Auto] 开始执行详情页任务点击，当前状态: ${currentDetailState}/5`);
            // 【防封号】操作前随机延迟 2-4 秒
            await Utils.randomDelay(3000, 8000);
            
            // 查找可用的任务按钮
            const enabledButtons = document.querySelectorAll(
                "a[data-rac][target='_blank']:not([aria-disabled='true']):not([data-disabled='true'])"
            );
            const disabledButtons = document.querySelectorAll(
                "a[data-rac][target='_blank'][aria-disabled='true'][data-disabled='true']"
            );
            
            console.log(`[Rewards Auto] 找到 ${enabledButtons.length} 个可用按钮，${disabledButtons.length} 个禁用按钮`);
            
            let clickableButton = null;
            
            // 优先查找包含特定文本的按钮
            for (const btn of enabledButtons) {
                const text = btn.textContent || "";
                const ariaLabel = btn.getAttribute("aria-label") || "";
                if (detailTextPatterns.some(pattern => text.includes(pattern) || ariaLabel.includes(pattern))) {
                    clickableButton = btn;
                    break;
                }
            }
            
            // 如果没有找到特定文本的按钮，使用第一个可用按钮
            if (!clickableButton && enabledButtons.length > 0) {
                clickableButton = enabledButtons[0];
            }
            
            if (!clickableButton) {
                console.log("[Rewards Auto] 未找到可用的任务按钮，所有任务可能已完成或需要等待解锁");
                return true;
            }
            
            const buttonText = clickableButton.textContent || "未知任务";
            const ariaLabel = clickableButton.getAttribute("aria-label") || buttonText;
            console.log(`[Rewards Auto] 准备点击任务按钮: "${buttonText}"`);
            
            // 【防封号】点击前随机延迟 3-8 秒
            await Utils.randomDelay(3000, 8000);
            
            try {
                await WebSession.ensure();
                clickableButton.click();
                console.log(`[Rewards Auto] 已点击任务按钮: "${buttonText}"`);
                GM_setValue(detailStateKey, currentDetailState + 1);
                GM_setValue(detailDateKey, today);
                // 【防封号】点击后随机延迟 2-4 秒
                await Utils.randomDelay(3000, 8000);
                return true;
            } catch (clickError) {
                console.error(`[Rewards Auto] 点击任务按钮失败: ${clickError.message}`);
                return false;
            }
        };

        const clickPunchCards = async (depth = 0) => {
            if (depth > 5) {
                console.log("[Rewards Auto] 打卡递归深度超限，停止");
                return;
            }
            const today = Utils.getTodayNum();
            const stateKey = "Config.punchCardState";
            const dateKey = "Config.punchCardDate";
            const savedDate = GM_getValue(dateKey, 0);
            let state = savedDate === today ? GM_getValue(stateKey, 0) : 0;

            if (state >= 2) {
                console.log("[Rewards Auto] 打卡任务已完成");
                return;
            }

            console.log(`[Rewards Auto] 打卡任务: ${state}/2`);
            // 【防封号】操作前随机延迟 3-8 秒
            await Utils.randomDelay(3000, 8000);

            let found = [];
            for (const sel of punchCardSelectors) {
                try {
                    found = await Utils.waitForElementsByText(sel, textPatterns, 10000);
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
                // 【防封号】点击前随机延迟
                await Utils.randomDelay();
                try {
                    await WebSession.ensure();
                    target.element.click();
                    GM_setValue(stateKey, state + 1);
                    GM_setValue(dateKey, today);
                    if (state + 1 < 2) {
                        // 【防封号】两次点击间隔 5-10 秒
                        await Utils.randomDelay(5000, 10000);
                        await clickPunchCards(depth + 1);
                    }
                } catch (e) {
                    console.error(`[Rewards Auto] 点击失败: ${e.message}`);
                }
            }
        };

        const startPunchCards = () => {
            setTimeout(() => WebSession.run(async () => {
                const path = location.pathname;
                if (path.includes("/earn/quest/") || path.includes("punchcard")) {
                    console.log("[Rewards Auto] 检测到打卡详情页，开始执行任务点击...");
                    await clickDetailTasks();
                } else {
                    console.log("[Rewards Auto] 检测到奖励主页，开始执行卡片点击...");
                    await clickPunchCards();
                }

                console.log("[Rewards Auto] 开始执行每日活动点击...");
                await TaskManager.doDailySet();

                console.log("[Rewards Auto] 检查可领取积分...");
                await TaskManager.doClaimPoints();
            }), 3000); // 延迟 3 秒等待页面渲染
        };
        
        if (document.readyState === "complete" || document.readyState === "interactive") {
            startPunchCards();
        } else {
            document.addEventListener("DOMContentLoaded", startPunchCards);
        }
    }

    if (isRedeemPage) return;

    GM_registerMenuCommand("🔑 手动授权", () => {
        GM_openInTab("https://login.live.com/oauth20_authorize.srf?client_id=0000000040170455&response_type=code&scope=service::prod.rewardsplatform.microsoft.com::MBI_SSL&redirect_uri=https://login.live.com/oauth20_desktop.srf", { active: true });
    });

    GM_registerMenuCommand("📋 粘贴授权码", () => {
        const code = prompt("粘贴授权页面跳转后的完整URL:");
        if (code?.trim()) {
            GM_setValue("Config.code", code.trim());
            alert("已保存！");
        }
    });

    GM_registerMenuCommand("📊 Token状态", () => {
        const token = GM_getValue("Config.token", false);
        const time = GM_getValue("Config.tokenTime", 0);
        let ageStr = "未知";
        if (time > 0) {
            const diff = Utils.getTimestamp() - time;
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
        alert(`Token: ${token ? "已保存" : "无"}\n获取时间: ${tokenDate}\n已过: ${ageStr}\n授权码: ${GM_getValue("Config.code", "") ? "有" : "无"}`);
    });

    GM_registerMenuCommand("🚀 立即运行", () => TaskManager.runAll());

    // 通知接口配置菜单
    GM_registerMenuCommand("🔔 配置通知接口", () => {
        const configNames = [
            { key: "Notice.wework", name: "企业微信 Webhook", hint: "群机器人webhook key" },
            { key: "Notice.dingding", name: "钉钉机器人 Access Token", hint: "不加签，关键词需包含 #" },
            { key: "Notice.feishu", name: "飞书机器人 Webhook", hint: "不加签，关键词需包含 #" },
            { key: "Notice.pushme", name: "PushMe Key", hint: "push.i-i.me 推送key" },
            { key: "Notice.bark", name: "Bark Key", hint: "bark.day.app 推送key" }
        ];
        
        let configStr = "🔔 通知接口配置\n";
        configStr += "==================\n\n";
        configNames.forEach((item, index) => {
            const saved = GM_getValue(item.key, "");
            configStr += `${index + 1}. ${item.name}\n`;
            configStr += `   状态: ${saved ? "✅ 已配置" : "❌ 未配置"}\n`;
            configStr += `   说明: ${item.hint}\n\n`;
        });
        configStr += "请输入要配置的编号 (1-5)，或输入 0 清除所有配置：";
        
        const choice = prompt(configStr);
        if (!choice) return;
        
        const num = parseInt(choice);
        if (num === 0) {
            if (confirm("确定要清除所有通知接口配置吗？")) {
                configNames.forEach(item => GM_setValue(item.key, ""));
                alert("所有通知接口配置已清除！");
            }
            return;
        }
        
        if (num >= 1 && num <= 5) {
            const selected = configNames[num - 1];
            const current = GM_getValue(selected.key, "");
            const newValue = prompt(`配置 ${selected.name}\n\n当前值: ${current || "(空)"}\n\n请输入新的值：`, current);
            if (newValue !== null) {
                GM_setValue(selected.key, newValue.trim());
                alert(`${selected.name} 已${newValue.trim() ? "配置" : "清除"}！`);
            }
        } else {
            alert("无效的编号！");
        }
    });

    GM_registerMenuCommand("📢 测试通知", () => {
        RewardsAuto.state.sendMSG = "🧪 这是一条测试消息\n如果你看到这条消息，说明通知接口配置成功！";
        Utils.log("📢", "测试通知已发送", true);
        alert("测试消息已发送，请检查各通知渠道！");
    });

    // 浏览器通知静默开关
    const updateBroMenu = () => {
        const enabled = GM_getValue("Notice.bro", true);
        return enabled ? "🔕 关闭浏览器通知" : "🔔 开启浏览器通知";
    };
    GM_registerMenuCommand(updateBroMenu(), () => {
        const current = GM_getValue("Notice.bro", true);
        GM_setValue("Notice.bro", !current);
        alert(`浏览器通知已${!current ? "开启" : "关闭"}`);
        location.reload();
    });

    GM_registerMenuCommand("📋 查看通知状态", () => {
        const wework = GM_getValue("Notice.wework", "");
        const dingding = GM_getValue("Notice.dingding", "");
        const feishu = GM_getValue("Notice.feishu", "");
        const pushme = GM_getValue("Notice.pushme", "");
        const bark = GM_getValue("Notice.bark", "");
        
        let status = "📊 通知接口配置状态：\n\n";
        status += `企业微信: ${wework ? "✅ 已配置" : "❌ 未配置"}\n`;
        status += `钉钉: ${dingding ? "✅ 已配置" : "❌ 未配置"}\n`;
        status += `飞书: ${feishu ? "✅ 已配置" : "❌ 未配置"}\n`;
        status += `PushMe: ${pushme ? "✅ 已配置" : "❌ 未配置"}\n`;
        status += `Bark: ${bark ? "✅ 已配置" : "❌ 未配置"}\n`;
        alert(status);
    });

    const init = () => WebSession.run(async () => {
        TaskManager.init();

        // 检查今日任务是否已完成
        const isKeep = GM_getValue("Config.keep", true);
        const checkDone = (enabled, date) => !enabled || date === RewardsAuto.state.dateNowNum;
        const isAllDone = checkDone(GM_getValue("Tasks.sign", true), TaskManager.signDate) &&
                          checkDone(GM_getValue("Tasks.read", true), TaskManager.readDate) &&
                          checkDone(GM_getValue("Tasks.promos", true), TaskManager.promosDate) &&
                          checkDone(GM_getValue("Tasks.search", true), TaskManager.searchDate);

        if (!isKeep && isAllDone) {
            Utils.log("💤", "今日任务已全部完成");
            return;
        }

        // 【防封号核心】随机延迟 5-95 秒启动，避免定时器特征
        const delay = Utils.randomRange(5000, 95000);
        Utils.log("⏳", `${delay/1000}秒后启动...`);
        setTimeout(() => TaskManager.runAll(), delay);
    });

    // 清除可能影响搜索的 Cookie
    GM_cookie("delete", { url: "https://bing.com", name: "_EDGE_S" });

    // ====== 前台页面处理器（dashboard 页面内执行 DOM 操作） ======
    if (isDashboardPage) {
        Utils.log("📅", "前台模式：统一处理 dashboard 任务...");

        // 地址重写或刷新可能丢失 hash；在当前标签页暂存标记，避免误判为手动打开。
        const dashboardTabKey = "RewardsAuto.dashboardTab";
        const dashboardLockId = (() => {
            const match = String(location.hash || "").match(/(?:^#|&)rauto=([^&]+)/);
            let lockId = "";
            if (match) {
                try { lockId = decodeURIComponent(match[1]); } catch (_) { lockId = match[1]; }
            }
            try {
                if (lockId) {
                    sessionStorage.setItem(dashboardTabKey, JSON.stringify({
                        id: lockId, expiresAt: Date.now() + dashboardLockTtl
                    }));
                } else {
                    const saved = JSON.parse(sessionStorage.getItem(dashboardTabKey) || "null");
                    if (typeof saved?.id === "string" && saved.id && Number(saved.expiresAt) > Date.now()) return saved.id;
                    sessionStorage.removeItem(dashboardTabKey);
                }
            } catch (_) {}
            return lockId;
        })();

        const releaseDashboardLock = async () => {
            if (!dashboardLockId) return;
            const lock = await GM_getValue(dashboardLockKey, null);
            if (lock?.id !== dashboardLockId) return;
            const now = Date.now();
            await GM_setValue(dashboardLockKey, {
                ...lock,
                completedAt: now,
                expiresAt: now + dashboardLockCooldown
            });
        };

        // 每日活动和积分处理完成后再关闭页面，避免提前中断。
        const closeDashboardPage = () => {
            if (!dashboardLockId) {
                Utils.log("📄", "当前 dashboard 是手动打开的，保留页面，不自动关闭");
                return;
            }

            Utils.log("📄", "每日活动和积分处理完成，准备关闭 dashboard 页面...");
            releaseDashboardLock().catch(() => {});
            setTimeout(() => {
                try { sessionStorage.removeItem(dashboardTabKey); } catch (_) {}
                const targets = [];
                try { if (typeof unsafeWindow !== "undefined") targets.push(unsafeWindow); } catch (_) {}
                try { if (typeof window !== "undefined" && !targets.includes(window)) targets.push(window); } catch (_) {}
                for (const target of targets) {
                    try {
                        if (typeof target.close === "function") target.close();
                    } catch (_) {}
                }
            }, 1500);
        };

        // 自动领取积分函数
        const autoClaimPoints = async () => {
            await WebSession.ensure();
            const CLAIM_ACTION = "00491296f1d668ad46b65342c95cb9d72a62c1fa9d";
            const ROUTER_STATE = "%5B%22%22%2C%7B%22children%22%3A%5B%22(nav)%22%2C%7B%22children%22%3A%5B%22dashboard%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%2C4096%5D%7D%2Cnull%2Cnull%2C4096%5D%7D%2Cnull%2Cnull%2C4096%5D%7D%2Cnull%2Cnull%2C4112%5D";
            const wait = ms => Utils.delay(ms);
            const normalize = text => String(text || "").normalize("NFKC").replace(/\s+/g, " ").trim();
            const findClaimCard = () => Array.from(document.querySelectorAll('button, [role="button"], a[href]'))
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
                if (!card) {
                    Utils.log("📅", "等待后仍未找到可领取积分卡片，按无需领取处理");
                    return { claimed: false, amount: 0, status: "none" };
                }

                const amountText = String(card.text || "");
                const amountMatch = amountText.match(/(\d[\d,\s]*)/);
                const amount = amountMatch
                    ? parseInt(amountMatch[1].replace(/[\s,]/g, ""), 10) || 0
                    : 0;
                if (amount <= 0) {
                    Utils.log("📅", "可领取积分为 0");
                    return { claimed: false, amount: 0, status: "none" };
                }

                Utils.log("🎁", `发现 ${amount} 积分待领取，调用领取接口...`);
                const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
                const response = await pageWindow.fetch("https://rewards.bing.com/dashboard", {
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
                WebSession.assertActive();
                const responseText = await response.text();
                await WebSession.ensure();
                if (!response.ok) {
                    Utils.log("🟡", `领取接口返回 HTTP ${response.status}，Next-Action 可能已更新`);
                    return { claimed: false, amount, status: "failed" };
                }
                if (API.activityResponseResult(responseText, true) !== true) {
                    Utils.log("🟡", `领取接口未返回成功标记: ${responseText.slice(0, 160)}`);
                    return { claimed: false, amount, status: "failed" };
                }
                Utils.log("🎁", `${amount} 积分领取成功（服务端已确认）！`);
                return { claimed: true, amount, status: "claimed" };
            } catch (e) {
                Utils.log("🟡", `自动领取积分失败: ${e.message}`);
                return { claimed: false, amount: 0, status: "failed" };
            }
        };

        const getIncompleteDailySetLinks = () => Array.from(document.querySelectorAll('a[href*="rnoreward=1"]'))
            .filter(link => !new URL(link.href, location.href).pathname.startsWith("/redeem"))
            .filter(link => {
                const text = link.textContent || "";
                return !text.includes("已完成") && !text.includes("Completed");
            });

        // 自动点击每日活动函数
        const autoClickDailySet = async () => {
            try {
                // 等待页面加载
                await Utils.delay(3000);
                await WebSession.ensure();

                const incompleteLinks = getIncompleteDailySetLinks();

                Utils.log("📅", `找到 ${incompleteLinks.length} 个未完成的每日活动`);
                let clickCount = 0;

                for (const link of incompleteLinks) {
                    await WebSession.ensure();
                    const title = link.querySelector('p')?.textContent?.trim()?.substring(0, 30) || "未知活动";
                    Utils.log("📅", `点击活动: ${title}`);
                    await Utils.delay(3000 + Math.random() * 5000);
                    await WebSession.ensure();
                    link.click();
                    clickCount++;
                    await Utils.delay(3000 + Math.random() * 5000);
                }

                // 等待页面状态更新，再确认页面上已没有未完成活动。
                await Utils.delay(1500);
                await WebSession.ensure();
                const remainingLinks = getIncompleteDailySetLinks();
                const completed = remainingLinks.length === 0;
                if (completed) {
                    Utils.log("📅", `每日活动已处理，点击了 ${clickCount} 个活动`);
                } else {
                    Utils.log("🟡", `每日活动仍有 ${remainingLinks.length} 个链接未确认完成，暂不关闭页面`);
                }
                return { completed, clicked: clickCount, remaining: remainingLinks.length };
            } catch (e) {
                Utils.log("🟡", `每日活动点击失败: ${e.message}`);
                return { completed: false, clicked: 0, remaining: -1 };
            }
        };

        // 页面加载后自动执行
        setTimeout(() => WebSession.run(async () => {
            Utils.log("📅", "页面加载完成，开始自动处理...");
            const dailyResult = await autoClickDailySet();
            await WebSession.ensure();
            if (dailyResult?.completed === true) {
                GM_setValue("Config.dailySetCompleted", Utils.getTodayNum());
            }

            const claimResult = await autoClaimPoints();
            await WebSession.ensure();
            const claimDone = claimResult?.claimed === true || claimResult?.status === "none";
            if (dailyResult?.completed === true && claimDone) {
                closeDashboardPage();
            } else {
                const dailyState = dailyResult?.completed === true ? "已确认" : "未确认";
                const claimState = claimResult?.claimed === true
                    ? "已领取"
                    : claimResult?.status === "none" ? "无需领取" : "失败";
                Utils.log("🟡", `dashboard 暂不关闭：每日活动${dailyState}，积分${claimState}`);
            }
        }), 5000);

        // 前台模式统一执行一次，不再监听旧的跨标签页指令，避免重复点击。
        return;
    }

    // ====== 后台模式入口 ======
    init();

})();
