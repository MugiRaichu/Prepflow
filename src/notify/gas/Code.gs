/**
 * プレノラ — LINE通知（Google Apps Script 側）
 *
 * 役割は3つだけ。
 *   1. アプリから送られてくる「今週の献立」を受け取って保存する（doPost）
 *   2. 毎日きまった時刻に、その日のぶんを LINE へ送る（sendToday）
 *   3. 自分の Google カレンダーの予定を、件名と時刻だけアプリへ返す（events）
 *   4. 決まった献立を「プレノラ」カレンダーに書く（publish）。他のカレンダーには触れない
 *
 * アプリはローカルファーストなので、ここに置くのは「送るための最小の写し」だけ。
 * 体重・栄養・買い物の中身は送らない。
 *
 * --- 設置手順 -------------------------------------------------------------
 * 1. script.google.com で新しいプロジェクトを作り、このファイルを貼る
 * 2. プロジェクトの設定 > スクリプト プロパティ に次を登録する
 *      LINE_TOKEN   … LINE Developers のチャネルアクセストークン（長期）
 *      LINE_USER_ID … 自分のユーザーID
 *      SHARED_TOKEN … 好きな長い文字列（アプリ側の設定にも同じものを入れる）
 * 3. デプロイ > 新しいデプロイ > 種類「ウェブアプリ」
 *      次のユーザーとして実行: 自分
 *      アクセスできるユーザー: 全員
 *    → 出てきた URL をアプリの設定に貼る
 * 4. setupTrigger を1回だけ手動実行する（毎日のトリガーが作られる）
 * -------------------------------------------------------------------------
 */

var PROPS = PropertiesService.getScriptProperties();

/*
 * 合言葉。**共有だけなら、ここに入れておけば設定画面の登録が要らない。**
 *
 * スクリプトプロパティに3つ登録する作業は、スマホしか使わない人には重い。
 * 家族共有だけを使う人のために、アプリが作った合言葉をコードに埋めた形で
 * コピーできるようにした（下の1行がその置き場）。
 * プロパティに入っていればそちらを優先する（LINE を使う人は今までどおり）。
 */
var TOKEN_IN_CODE = '';
var LINE_TOKEN_IN_CODE = '';
var LINE_USER_ID_IN_CODE = '';

function sharedToken() {
  return PROPS.getProperty('SHARED_TOKEN') || TOKEN_IN_CODE;
}
function lineToken() {
  return PROPS.getProperty('LINE_TOKEN') || LINE_TOKEN_IN_CODE;
}
function lineUserId() {
  return PROPS.getProperty('LINE_USER_ID') || LINE_USER_ID_IN_CODE;
}

/** 献立を書く先のカレンダー名。読むときはこの名前のものを飛ばす */
/*
 * 書き出し先のカレンダー名。**利用者の Google カレンダーに、この名前で現れる。**
 * 名前を変えると、次に書いたときに新しいカレンダーが作られる。
 * 前の「Prepflow」カレンダーは残るので、要らなければ手で消す。
 */
var PREPFLOW_CALENDAR = 'プレノラ';

/**
 * 許可を出すためだけの関数。エディタから1回だけ実行する。
 *
 * ウェブアプリは「自分として実行」なので、使う機能（カレンダー・外部通信・トリガー）の
 * 許可を本人が一度出しておく必要がある。デプロイの画面で出ることもあるが、
 * コードを貼り直して機能が増えたときは出ないことがある。
 * ここを実行すれば、必要な許可がまとめて求められる。
 */
/**
 * 古い健康データを捨てる。
 * スクリプトプロパティは 500KB までなので、貯め続けると詰まる。
 * アプリは開くたびに取りに来るので、60日ぶんあれば十分。
 */
function pruneHealth() {
  var keep = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  var all = PROPS.getProperties();
  for (var k in all) {
    if (k.indexOf('health:') !== 0) continue;
    if (k.slice(7) < keep) PROPS.deleteProperty(k);
  }
}

/**
 * 今日から days 日ぶんの予定を読む。
 *
 * **速さは、Google に何回聞くかで決まる。**CalendarApp は
 * `getTitle()` のような1つ1つの呼び出しが向こうへの問い合わせになるので、
 * 同じ値を2回聞くとそのぶん待ち時間が増える。
 *
 *   前 … 予定1件につき start を3回・end を2回・title を2回聞いていた（8回）
 *   今 … 1回ずつ受け取って変数に置く（4回）
 *
 * 予定が50件あれば、200回の問い合わせが100回になる。
 * カレンダーの数だけ getEvents も走るので、そこは1つも無駄にしない。
 */
function readEvents(days) {
  var n = Math.min(Math.max(parseInt(days, 10) || 7, 1), 14);
  var from = new Date();
  from.setHours(0, 0, 0, 0);
  var to = new Date(from.getTime() + n * 86400000);

  // 自分のカレンダーだけでなく、共有されているものも読む。
  // 「仕事」「家族」と分けている人や、別アカウントのカレンダーを
  // このアカウントに共有している人に要る。同じ予定が複数に入っていれば1つにする
  var seen = {};
  var events = [];
  var cals = CalendarApp.getAllCalendars();
  for (var i = 0; i < cals.length; i++) {
    var cal = cals[i];
    // 自分が書いた献立（プレノラ カレンダー）は「予定」ではない。
    // 読んでしまうと、献立が食事の時刻を押しのける循環になる
    if (cal.getName() === PREPFLOW_CALENDAR) continue;

    var list = cal.getEvents(from, to);
    for (var j = 0; j < list.length; j++) {
      var ev = list[j];
      // 1件につき1回ずつだけ聞いて、あとは変数を使い回す
      var s = ev.getStartTime();
      var e = ev.getEndTime();
      var title = ev.getTitle();
      var key = s.getTime() + '|' + e.getTime() + '|' + title;
      if (seen[key]) continue;
      seen[key] = true;
      events.push({
        date: Utilities.formatDate(s, 'Asia/Tokyo', 'yyyy-MM-dd'),
        start: Utilities.formatDate(s, 'Asia/Tokyo', 'HH:mm'),
        end: Utilities.formatDate(e, 'Asia/Tokyo', 'HH:mm'),
        title: title,
        allDay: ev.isAllDayEvent(),
      });
    }
  }
  return events;
}

/** 貯めてある歩数を全部返す。プロパティは1回の読み出しでまとめて取る */
function readHealth() {
  var out = [];
  var all = PROPS.getProperties();
  for (var k in all) {
    if (k.indexOf('health:') !== 0) continue;
    try {
      out.push(JSON.parse(all[k]));
    } catch (err) {
      // 壊れている行は捨てる
    }
  }
  out.sort(function (a, b) {
    return a.date < b.date ? -1 : 1;
  });
  return out;
}

function authorize() {
  CalendarApp.getDefaultCalendar().getName();
  ScriptApp.getProjectTriggers();
  // 家族の共有はドライブの1ファイルに置く。ここで許可をまとめて取る
  DriveApp.getRootFolder().getName();
  return 'ok';
}

/** アプリからの受け口 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    // 共有トークンが合わないものは捨てる。URLだけ知られても書き込めないようにする
    if (!sharedToken() || body.token !== sharedToken()) {
      return json({ ok: false, error: 'bad token' });
    }

    if (body.action === 'ping') {
      return json({ ok: true, pong: true });
    }

    if (body.action === 'test') {
      pushLine('プレノラ のテスト通知です。これが届けば設定は完了しています。');
      return json({ ok: true, sent: true });
    }

    /*
     * 今日のぶんをいますぐ送る。
     *
     * 「今週を送る」は献立を**預けるだけ**で、LINE に流れるのは毎日の
     * トリガーが動く時刻。押した直後に何も届かないので、壊れているように見える。
     * 手で今すぐ流せる口を用意する。
     */
    if (body.action === 'pushNow') {
      return json({ ok: true, count: sendToday() });
    }

    /*
     * いまの状態を返す。**推測で直させない。**
     *
     * 毎日の通知が来ないとき、原因は「献立を預けていない」「今日のぶんが
     * 無い」「トリガーが無い」「スクリプトのタイムゾーンがずれている」の
     * どれか。外からは全部同じ「来ない」に見えるので、中身を出す。
     */
    if (body.action === 'status') {
      var rawS = PROPS.getProperty('SCHEDULE');
      var list = [];
      try {
        list = rawS ? JSON.parse(rawS) : [];
      } catch (err) {
        list = [];
      }
      var dates = list.map(function (x) {
        return x.date;
      });
      var todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
      var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) {
        return t.getHandlerFunction() === 'sendToday';
      });
      return json({
        ok: true,
        count: list.length,
        from: dates.length ? dates.sort()[0] : null,
        to: dates.length ? dates.sort()[dates.length - 1] : null,
        today: todayStr,
        todayCount: dates.filter(function (d) {
          return d === todayStr;
        }).length,
        pushTime: PROPS.getProperty('PUSH_TIME') || null,
        updatedAt: PROPS.getProperty('UPDATED_AT') || null,
        hasTrigger: hasTrigger,
        // トリガーの時刻はこのタイムゾーンで解釈される。
        // Asia/Tokyo でないと、選んだ時刻と実際に動く時刻がずれる
        timeZone: Session.getScriptTimeZone(),
      });
    }

    // events: 自分の Google カレンダーの予定を返す（読むだけ。書き込まない）。
    // このスクリプトは自分のアカウントで動くので、OAuth の画面も
    // Google Cloud のプロジェクトも要らない。初回の許可にカレンダーの読み取りが含まれる。
    // 返すのは件名と時刻だけ。相手先や場所や本文は返さない
    if (body.action === 'events') {
      return json({ ok: true, events: readEvents(body.days) });
    }

    /*
     * sync: カレンダーの予定と歩数を**1回の往復でまとめて**返す。
     *
     * 前は events と healthPull を別々に呼んでいた。1往復のうち、
     * スクリプトの起動（1〜3秒）と 302 の回り道は中身と関係なく毎回かかるので、
     * **2回に分けるとその待ちを2回ぶん払っていた**（本人「もっと高速化できませんか」）。
     *
     * 要らないほうは読みにいかない。events も health も false なら、
     * 返事だけがすぐ返る。
     */
    if (body.action === 'sync') {
      var out = { ok: true };
      if (body.events) out.events = readEvents(body.days);
      if (body.health) out.samples = readHealth();
      return json(out);
    }

    // publish: 献立を「プレノラ」カレンダーに書く。
    // 無ければ作る。対象期間の中身を**このカレンダーだけ**入れ替える（他には触れない）。
    // items: [{ date, start:'HH:mm', minutes, title, description, allDay }]
    if (body.action === 'publish') {
      var cal = CalendarApp.getCalendarsByName(PREPFLOW_CALENDAR)[0];
      if (!cal) cal = CalendarApp.createCalendar(PREPFLOW_CALENDAR);

      var rangeFrom = new Date(body.from + 'T00:00:00+09:00');
      var rangeTo = new Date(body.to + 'T23:59:59+09:00');
      cal.getEvents(rangeFrom, rangeTo).forEach(function (ev) {
        ev.deleteEvent();
      });

      var items = body.items || [];
      items.forEach(function (it) {
        var opts = { description: it.description || '' };
        if (it.allDay) {
          cal.createAllDayEvent(it.title, new Date(it.date + 'T00:00:00+09:00'), opts);
        } else {
          var s = new Date(it.date + 'T' + it.start + ':00+09:00');
          var e = new Date(s.getTime() + (it.minutes || 30) * 60000);
          cal.createEvent(it.title, s, e, opts);
        }
      });
      return json({ ok: true, count: items.length });
    }

    /*
     * clear: 書いた献立を消す。**書き直さずに消したいときの口。**
     *
     * publish は「消してから書く」ので入れ替えはできるが、
     * 「やっぱり全部消す」ができなかった。手で消すしかない状態だった。
     * 消すのは プレノラ カレンダーの中だけ。他のカレンダーには触れない。
     */
    if (body.action === 'clear') {
      var delCal = CalendarApp.getCalendarsByName(PREPFLOW_CALENDAR)[0];
      if (!delCal) return json({ ok: true, count: 0 });
      var f = new Date(body.from + 'T00:00:00+09:00');
      var t = new Date(body.to + 'T23:59:59+09:00');
      var evs = delCal.getEvents(f, t);
      evs.forEach(function (ev) {
        ev.deleteEvent();
      });
      return json({ ok: true, count: evs.length });
    }

    // schedule: [{ date: '2026-09-07', slot: '夕', text: 'A1 鶏むねの照り焼き 220g' }]
    if (body.schedule) {
      PROPS.setProperty('SCHEDULE', JSON.stringify(body.schedule));
      PROPS.setProperty('PUSH_TIME', body.pushTime || '17:30');
      PROPS.setProperty('UPDATED_AT', new Date().toISOString());
      setupTrigger();
      return json({ ok: true, count: body.schedule.length });
    }

    /*
     * health: iPhone のショートカットから、その日の歩数と消費カロリーを受ける。
     *
     * ショートカット側は「URLの内容を取得」で POST する。「URLを開く」ではないので
     * **画面は開かない**。オートメーションに載せれば、設定は最初の1回で済む。
     *
     * 貯めるのはスクリプトプロパティ。日付をキーにして上書きするので、
     * 同じ日に何度送っても増えない。持つのは日付・歩数・kcal だけで、
     * 名前も位置も持たない。
     */
    if (body.action === 'health') {
      var date = String(body.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return json({ ok: false, error: 'bad date' });
      }
      var rec = {
        date: date,
        steps: Math.max(0, Math.round(Number(body.steps) || 0)),
        activeKcal: Math.max(0, Math.round(Number(body.activeKcal) || 0)),
      };
      PROPS.setProperty('health:' + date, JSON.stringify(rec));
      pruneHealth();
      return json({ ok: true, saved: rec });
    }

    // healthPull: 貯めてあるぶんをアプリが取りに来る
    /*
     * family: 家族で共有する置き場所。
     *
     * **置き場所は Google ドライブの1ファイル。**スクリプトプロパティは
     * 全部で500KBしかなく、買い出しリストと容器を数週ぶん置くと詰まる。
     *
     * 送るのは「変わったものだけ」、返すのは「相手が知らないものだけ」。
     * 同じものを両方で直したときは、**あとに直したほうを採る**（updatedAt）。
     * 人の体のこと（体格・目標・体重・歩数）は最初から送られてこない。
     * ここに入るのは買い物と食べ物の在庫だけ（アプリ側で選んでいる）。
     */
    if (body.action === 'familyPull' || body.action === 'familyPush') {
      var lock = LockService.getScriptLock();
      // 家族が同時に押すことはある。待てないなら諦めて、次の同期に任せる
      if (!lock.tryLock(20000)) return json({ ok: false, error: 'busy' });
      try {
        var doc = readFamily();
        var incoming = body.records || [];
        var changed = 0;

        for (var i = 0; i < incoming.length; i++) {
          var rec = incoming[i];
          if (!rec || !rec.store || !rec.id) continue;
          var key = rec.store + '/' + rec.id;
          var cur = doc.records[key];
          // あとに直したほうを採る。同じ時刻なら触らない
          if (cur && String(cur.updatedAt) >= String(rec.updatedAt)) continue;
          doc.records[key] = rec;
          changed++;
        }
        if (changed > 0) {
          doc.rev = (doc.rev || 0) + 1;
          writeFamily(doc);
        }

        // 相手が持っていないぶんだけ返す
        var since = String(body.since || '');
        var out = [];
        for (var k in doc.records) {
          var r = doc.records[k];
          if (!since || String(r.updatedAt) > since) out.push(r);
        }
        return json({ ok: true, records: out, saved: changed, now: new Date().toISOString() });
      } finally {
        lock.releaseLock();
      }
    }

    if (body.action === 'healthPull') {
      return json({ ok: true, samples: readHealth() });
    }

    return json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/**
 * 毎日のトリガーが呼ぶ。今日のぶんだけ送る。
 * 送った件数を返す（0 なら「今日のぶんが無い」で、失敗ではない）。
 */
function sendToday() {
  var raw = PROPS.getProperty('SCHEDULE');
  if (!raw) return 0;

  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var items = JSON.parse(raw).filter(function (x) {
    return x.date === today;
  });
  if (items.length === 0) return 0;

  var lines = items.map(function (x) {
    return '［' + x.slot + '］' + x.text;
  });
  pushLine('今日の食事\n' + lines.join('\n'));
  return items.length;
}

/** 毎日のトリガーを作り直す */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendToday') ScriptApp.deleteTrigger(t);
  });

  var time = PROPS.getProperty('PUSH_TIME') || '17:30';
  var hour = parseInt(time.split(':')[0], 10);
  var minute = parseInt(time.split(':')[1], 10) || 0;

  // 分を捨てていたので、17:30 を選んでも「17時台のどこか」に届いていた。
  // GAS の時刻トリガーは15分ほどの幅を持つので厳密にはならないが、近くにはなる
  ScriptApp.newTrigger('sendToday')
    .timeBased()
    .everyDays(1)
    .atHour(hour)
    .nearMinute(minute)
    .create();
}

/**
 * LINE に1通押し出す。
 *
 * **返事を必ず見る。**ここは muteHttpExceptions を付けたまま返事を捨てていた。
 * その結果、トークンが違っても・友だち追加していなくても・上限に達していても
 * 例外は出ず、アプリには「成功しました」と表示され、LINE には何も届かなかった。
 * 疎通確認（ping）は LINE を通らないので、そこだけは成功していた。
 * 「疎通は確認しているのに届かない」の正体はこれ（本人報告）。
 *
 * LINE は理由を本文で返してくるので、そのまま持ち帰って画面に出す。
 * 握りつぶすくらいなら、多少読みにくくても理由を見せるほうがいい。
 */
function pushLine(text) {
  var token = lineToken();
  var userId = lineUserId();
  if (!token) throw new Error('LINE のアクセストークンが入っていません（アプリで貼ってコードを取り直してください）');
  if (!userId) throw new Error('LINE のユーザーIDが入っていません（アプリで貼ってコードを取り直してください）');

  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: userId, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true,
  });

  var code = res.getResponseCode();
  if (code === 200) return;

  /*
   * 取り違えを名指しする。
   * チャネルシークレットは32文字、チャネルアクセストークンは数百文字。
   * 同じ画面に並んでいて名前も似ているので、まずここを疑う
   */
  if (code === 401 && token.length < 100) {
    throw new Error(
      'LINE_TOKEN が短すぎます（' +
        token.length +
        '文字）。チャネルシークレットかチャネルIDを入れていませんか。' +
        '要るのは「Messaging API設定」タブ一番下の チャネルアクセストークン（長期） です'
    );
  }

  var detail = '';
  try {
    var body = JSON.parse(res.getContentText());
    detail = body.message || '';
    if (body.details && body.details.length && body.details[0].message) {
      detail += '（' + body.details[0].message + '）';
    }
  } catch (err) {
    detail = String(res.getContentText()).slice(0, 200);
  }

  throw new Error('LINE が受け取りませんでした: HTTP ' + code + ' ' + detail + hintFor(code, detail));
}

/**
 * よくある失敗の直し方を1行だけ添える。
 * HTTPコードを見せても、どこを直せばよいかは分からない。
 */
function hintFor(code, detail) {
  if (code === 401) {
    return ' / LINE_TOKEN を見直してください。短期のトークンは切れます（長期のチャネルアクセストークンを使う）';
  }
  if (code === 403) {
    return ' / このチャネルから送れません。Messaging API チャネルであること、応答設定を確認してください';
  }
  if (code === 400) {
    return ' / LINE_USER_ID を見直してください。U で始まる自分のユーザーID（チャネルの基本設定にあります）で、そのチャネルを友だち追加している必要があります';
  }
  if (code === 429) {
    return ' / 今月の無料の送信数を使い切っています。翌月まで届きません';
  }
  return '';
}

/** 共有ファイルの名前。ドライブの一番上に置く */
/*
 * 家族の置き場。**名前は変えない。**変えると、すでに共有している家族の
 * ファイルが見つからなくなり、買い出しも在庫も一度消える。
 * この名前は人の目に触れない（ドライブの中のファイル名）ので、旧名のままでよい。
 */
var FAMILY_FILE = 'Prepflow-family.json';

function familyFile() {
  var it = DriveApp.getFilesByName(FAMILY_FILE);
  if (it.hasNext()) return it.next();
  return DriveApp.createFile(FAMILY_FILE, JSON.stringify({ rev: 0, records: {} }), 'application/json');
}

function readFamily() {
  try {
    var doc = JSON.parse(familyFile().getBlob().getDataAsString());
    if (!doc.records) doc.records = {};
    return doc;
  } catch (err) {
    // 壊れていたら作り直す。共有は写しなので、各自の端末に本体が残っている
    return { rev: 0, records: {} };
  }
}

function writeFamily(doc) {
  familyFile().setContent(JSON.stringify(doc));
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
