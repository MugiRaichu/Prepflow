/**
 * Prepflow — LINE通知（Google Apps Script 側）
 *
 * 役割は3つだけ。
 *   1. アプリから送られてくる「今週の献立」を受け取って保存する（doPost）
 *   2. 毎日きまった時刻に、その日のぶんを LINE へ送る（sendToday）
 *   3. 自分の Google カレンダーの予定を、件名と時刻だけアプリへ返す（events）
 *   4. 決まった献立を「Prepflow」カレンダーに書く（publish）。他のカレンダーには触れない
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

/** 献立を書く先のカレンダー名。読むときはこの名前のものを飛ばす */
var PREPFLOW_CALENDAR = 'Prepflow';

/**
 * 許可を出すためだけの関数。エディタから1回だけ実行する。
 *
 * ウェブアプリは「自分として実行」なので、使う機能（カレンダー・外部通信・トリガー）の
 * 許可を本人が一度出しておく必要がある。デプロイの画面で出ることもあるが、
 * コードを貼り直して機能が増えたときは出ないことがある。
 * ここを実行すれば、必要な許可がまとめて求められる。
 */
function authorize() {
  CalendarApp.getDefaultCalendar().getName();
  ScriptApp.getProjectTriggers();
  return 'ok';
}

/** アプリからの受け口 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    // 共有トークンが合わないものは捨てる。URLだけ知られても書き込めないようにする
    if (body.token !== PROPS.getProperty('SHARED_TOKEN')) {
      return json({ ok: false, error: 'bad token' });
    }

    if (body.action === 'ping') {
      return json({ ok: true, pong: true });
    }

    if (body.action === 'test') {
      pushLine('Prepflow のテスト通知です。これが届けば設定は完了しています。');
      return json({ ok: true, sent: true });
    }

    // events: 自分の Google カレンダーの予定を返す（読むだけ。書き込まない）。
    // このスクリプトは自分のアカウントで動くので、OAuth の画面も
    // Google Cloud のプロジェクトも要らない。初回の許可にカレンダーの読み取りが含まれる。
    // 返すのは件名と時刻だけ。相手先や場所や本文は返さない
    if (body.action === 'events') {
      var days = Math.min(Math.max(parseInt(body.days, 10) || 7, 1), 14);
      var from = new Date();
      from.setHours(0, 0, 0, 0);
      var to = new Date(from.getTime() + days * 86400000);
      // 自分のカレンダーだけでなく、共有されているものも読む。
      // 「仕事」「家族」と分けている人や、別アカウントのカレンダーを
      // このアカウントに共有している人に要る。同じ予定が複数に入っていれば1つにする
      var seen = {};
      var events = [];
      CalendarApp.getAllCalendars().forEach(function (cal) {
        // 自分が書いた献立（Prepflow カレンダー）は「予定」ではない。
        // 読んでしまうと、献立が食事の時刻を押しのける循環になる
        if (cal.getName() === PREPFLOW_CALENDAR) return;
        cal.getEvents(from, to).forEach(function (ev) {
          var key = ev.getStartTime().getTime() + '|' + ev.getEndTime().getTime() + '|' + ev.getTitle();
          if (seen[key]) return;
          seen[key] = true;
          events.push({
            date: Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd'),
            start: Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'HH:mm'),
            end: Utilities.formatDate(ev.getEndTime(), 'Asia/Tokyo', 'HH:mm'),
            title: ev.getTitle(),
            allDay: ev.isAllDayEvent(),
          });
        });
      });
      return json({ ok: true, events: events });
    }

    // publish: 献立を「Prepflow」カレンダーに書く。
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

    // schedule: [{ date: '2026-09-07', slot: '夕', text: 'A1 鶏むねの照り焼き 220g' }]
    if (body.schedule) {
      PROPS.setProperty('SCHEDULE', JSON.stringify(body.schedule));
      PROPS.setProperty('PUSH_TIME', body.pushTime || '17:30');
      PROPS.setProperty('UPDATED_AT', new Date().toISOString());
      setupTrigger();
      return json({ ok: true, count: body.schedule.length });
    }

    return json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** 毎日のトリガーが呼ぶ。今日のぶんだけ送る */
function sendToday() {
  var raw = PROPS.getProperty('SCHEDULE');
  if (!raw) return;

  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var items = JSON.parse(raw).filter(function (x) {
    return x.date === today;
  });
  if (items.length === 0) return;

  var lines = items.map(function (x) {
    return '［' + x.slot + '］' + x.text;
  });
  pushLine('今日の食事\n' + lines.join('\n'));
}

/** 毎日のトリガーを作り直す */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendToday') ScriptApp.deleteTrigger(t);
  });

  var time = PROPS.getProperty('PUSH_TIME') || '17:30';
  var hour = parseInt(time.split(':')[0], 10);

  ScriptApp.newTrigger('sendToday').timeBased().everyDays(1).atHour(hour).create();
}

function pushLine(text) {
  var token = PROPS.getProperty('LINE_TOKEN');
  var userId = PROPS.getProperty('LINE_USER_ID');
  if (!token || !userId) throw new Error('LINE_TOKEN / LINE_USER_ID が未設定です');

  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: userId, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true,
  });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
