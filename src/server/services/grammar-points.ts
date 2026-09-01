/**
 * Grammar points to build exercises around, by level.
 *
 * Naming situations varies what a sentence is about; naming a grammar point varies what the
 * sentence *is*, which is what actually stops the model writing 我很忙 in six costumes. It also
 * gives the practice a shape: over enough rounds a level's structures all come up, rather than
 * whichever ones the model happens to like.
 *
 * Written out here rather than taken from a published list, so there is no licence to worry
 * about. The levels are approximate — sources disagree, and HSK 3.0 renumbered everything — and
 * they do not need to be exact: they decide which structures a round draws on, not what anyone
 * is certified in. Each point carries a short example so the model cannot mistake what is meant.
 */
export interface GrammarPoint {
  level: number;
  point: string;
  example: string;
}

export const GRAMMAR_POINTS: GrammarPoint[] = [
  // HSK 1 — the bare bones of a sentence
  { level: 1, point: '是 for A is B', example: '他是老师' },
  { level: 1, point: 'adjective predicate with 很, no verb', example: '我很忙' },
  { level: 1, point: '的 for possession', example: '这是我的书' },
  { level: 1, point: '有 for having', example: '我有一个妹妹' },
  { level: 1, point: '有 for there being something somewhere', example: '桌子上有一本书' },
  { level: 1, point: '在 for where something is', example: '他在家' },
  { level: 1, point: 'yes-or-no question with 吗', example: '你去吗？' },
  { level: 1, point: 'question word 什么, 谁, 哪儿, 几, 多少', example: '你叫什么名字？' },
  { level: 1, point: '不 to negate', example: '我不喝茶' },
  { level: 1, point: '没有 for not having', example: '我没有钱' },
  { level: 1, point: '了 for something that has happened', example: '我吃了' },
  { level: 1, point: '想 for wanting to do something', example: '我想回家' },
  { level: 1, point: '会 for something learned', example: '我会说汉语' },
  { level: 1, point: '能 for being able to', example: '我今天不能来' },
  { level: 1, point: 'measure words 个, 本, 杯', example: '两本书' },
  { level: 1, point: 'time word before the verb', example: '我明天去' },
  { level: 1, point: '都 for all of them', example: '我们都是学生' },
  { level: 1, point: '也 for also', example: '我也想去' },
  { level: 1, point: '太…了 for too much of something', example: '太贵了' },
  { level: 1, point: '请 for a polite request', example: '请坐' },

  // HSK 2 — aspect, comparison, and the first complements
  { level: 2, point: '在 or 正在 for something going on now', example: '他在看书' },
  { level: 2, point: '过 for having done something before', example: '我去过北京' },
  { level: 2, point: '要 for intending to', example: '我要走了' },
  { level: 2, point: '可以 for being allowed to', example: '你可以坐这儿' },
  { level: 2, point: '因为…所以…', example: '因为下雨，所以我没去' },
  { level: 2, point: '虽然…但是…', example: '虽然很累，但是很高兴' },
  { level: 2, point: '比 for comparing', example: '他比我高' },
  { level: 2, point: '得 for how an action is done', example: '他跑得很快' },
  { level: 2, point: '有点儿 for a complaint, 一点儿 for a small amount', example: '有点儿贵' },
  { level: 2, point: '就 for sooner than expected, 才 for later', example: '他六点就来了' },
  { level: 2, point: '从…到… for a stretch of time or space', example: '从家到公司要半小时' },
  { level: 2, point: '离 for how far apart', example: '学校离这儿很近' },
  { level: 2, point: '给 for who something is done for', example: '我给你打电话' },
  { level: 2, point: 'verb reduplication for doing something briefly', example: '你看看' },
  { level: 2, point: '别 for telling someone not to', example: '别走' },
  { level: 2, point: 'result complements 完, 好, 到', example: '我吃完了' },
  { level: 2, point: '每…都…', example: '他每天都锻炼' },
  { level: 2, point: '是不是 to ask for confirmation', example: '你是不是累了？' },
  { level: 2, point: '还是 for offering a choice', example: '你喝茶还是咖啡？' },
  { level: 2, point: '一起 for doing something together', example: '我们一起去吧' },

  // HSK 3 — moving things around the sentence
  { level: 3, point: '把 to put the object before the verb', example: '请把门关上' },
  { level: 3, point: '被 for something done to the subject', example: '我的车被人开走了' },
  { level: 3, point: '如果…就…', example: '如果下雨，我们就不去' },
  { level: 3, point: '一边…一边… for two things at once', example: '他一边吃饭一边看电视' },
  { level: 3, point: '越来越… for a growing degree', example: '天气越来越冷' },
  { level: 3, point: '又…又… for two qualities together', example: '这家店又便宜又好' },
  { level: 3, point: 'direction complements 进去, 出来, 上去', example: '他走进去了' },
  { level: 3, point: 'potential complements 听得懂, 做不完', example: '我听不懂' },
  { level: 3, point: '除了…以外', example: '除了他以外，大家都来了' },
  { level: 3, point: '先…然后… for one thing after another', example: '先吃饭，然后去看电影' },
  { level: 3, point: '一…就… for one thing straight after another', example: '我一到就给你打电话' },
  { level: 3, point: '快要…了 for something about to happen', example: '快要下雨了' },
  { level: 3, point: '着 for a state that stays', example: '门开着' },
  { level: 3, point: '为了 for the purpose of', example: '为了考试，他每天学习' },
  { level: 3, point: 'how long something went on', example: '我学了两年汉语' },
  { level: 3, point: '…的时候 for when something happened', example: '我小的时候住在南方' },
  { level: 3, point: '应该 and 必须 for what ought to be done', example: '你应该早点休息' },
  { level: 3, point: '不但…而且…', example: '他不但会说，而且说得很好' },
  { level: 3, point: '像…一样 for likeness', example: '他像他爸爸一样高' },
  { level: 3, point: '多 or 少 before the verb', example: '你要多喝水' },

  // HSK 4 — joining clauses, and saying how you feel about what you say
  {
    level: 4,
    point: '是…的 for the when, where or how of something settled',
    example: '我是昨天来的',
  },
  { level: 4, point: '只要…就…', example: '只要你来，我就等你' },
  { level: 4, point: '只有…才…', example: '只有努力才能成功' },
  { level: 4, point: '无论…都…', example: '无论多难，他都不放弃' },
  { level: 4, point: '即使…也…', example: '即使很贵，我也要买' },
  { level: 4, point: '连…都/也… for even', example: '他连饭都没吃就走了' },
  { level: 4, point: '不是…而是…', example: '我不是不想去，而是没时间' },
  { level: 4, point: '由于…因此…', example: '由于天气不好，因此比赛取消了' },
  { level: 4, point: '尽管…还是…', example: '尽管很累，他还是去上班了' },
  {
    level: 4,
    point: '让 or 使 for making someone do or feel something',
    example: '这件事让我很生气',
  },
  { level: 4, point: '却 for a turn against expectation', example: '他知道，却什么也没说' },
  { level: 4, point: '于是 for what followed', example: '天太晚了，于是我们回家了' },
  { level: 4, point: '甚至 for the extreme case', example: '他忙得甚至忘了吃饭' },
  { level: 4, point: '结果 for how it turned out', example: '我等了一小时，结果他没来' },
  { level: 4, point: '对…来说 for whose point of view', example: '对我来说，这不难' },
  { level: 4, point: '以为 for what was wrongly believed', example: '我以为你不来了' },
  { level: 4, point: '难道 for a rhetorical question', example: '难道你不知道吗？' },
  { level: 4, point: '最好 for advice', example: '你最好先问问他' },
  { level: 4, point: '既然…就…', example: '既然来了，就多坐一会儿' },
  { level: 4, point: '不管…都…', example: '不管你说什么，他都不听' },

  // HSK 5 — argument, concession and degree
  {
    level: 5,
    point: '随着… for what changes alongside something else',
    example: '随着年龄的增长，他变得更冷静了',
  },
  { level: 5, point: '除非…否则…', example: '除非你亲自去，否则问题解决不了' },
  { level: 5, point: '与其…不如…', example: '与其抱怨，不如想办法' },
  { level: 5, point: '宁可…也不…', example: '他宁可自己吃亏，也不愿意麻烦别人' },
  { level: 5, point: '反而 for the opposite of what was expected', example: '吃了药反而更难受了' },
  { level: 5, point: '竟然 for something hard to believe', example: '他竟然一句话也没说' },
  { level: 5, point: '之所以…是因为…', example: '他之所以成功，是因为从不放弃' },
  { level: 5, point: '一旦…就…', example: '一旦决定了，就不要后悔' },
  { level: 5, point: '万一 for the unlikely but bad', example: '万一下雨怎么办？' },
  { level: 5, point: '就算…也…', example: '就算失败了，也值得试一次' },
  { level: 5, point: '未必 for not necessarily', example: '贵的未必就是好的' },
  { level: 5, point: '难免 for what can hardly be avoided', example: '第一次上台，难免有点紧张' },
  { level: 5, point: '以免 for heading something off', example: '早点出发，以免堵车' },
  {
    level: 5,
    point: '在…下 for the conditions something happened under',
    example: '在大家的帮助下，他完成了任务',
  },
  { level: 5, point: '从…来看 for the angle taken', example: '从目前的情况来看，问题不大' },
  {
    level: 5,
    point: '与…相比 for comparing two things',
    example: '与去年相比，今年的收入增加了不少',
  },
  { level: 5, point: '不仅…还… for more than expected', example: '他不仅会开车，还会修车' },
  { level: 5, point: '何况 for the stronger case', example: '大人都搬不动，何况孩子' },
  { level: 5, point: '干脆 for giving up the half measure', example: '既然没人来，干脆取消吧' },
  { level: 5, point: '总之 for summing up', example: '总之，这件事不能再拖了' },

  // HSK 6 — the register of writing and argument
  { level: 6, point: '不得不 for having no choice', example: '他不得不放弃这个机会' },
  {
    level: 6,
    point: '以至于 for the consequence going that far',
    example: '他太投入了，以至于忘了时间',
  },
  {
    level: 6,
    point: '从而 for what it thereby brought about',
    example: '这项技术降低了成本，从而提高了竞争力',
  },
  { level: 6, point: '鉴于 for what it is in view of', example: '鉴于目前的情况，会议推迟举行' },
  { level: 6, point: '倘若…则… in a formal register', example: '倘若处理不当，则后果严重' },
  { level: 6, point: '归根结底 for what it comes down to', example: '归根结底，还是钱的问题' },
  {
    level: 6,
    point: '相对而言 for the comparison being relative',
    example: '相对而言，这个方案更稳妥',
  },
  { level: 6, point: '势必 for what is bound to follow', example: '这样下去势必影响质量' },
  { level: 6, point: '未免 for a mild reproach', example: '你这样说未免太过分了' },
  {
    level: 6,
    point: '与此同时 for what went on alongside',
    example: '经济在增长，与此同时，环境压力也在加大',
  },
  { level: 6, point: '为…所… for a written passive', example: '这种做法为大家所接受' },
  { level: 6, point: '之 as a written 的', example: '这是他一生之中最重要的决定' },
  {
    level: 6,
    point: '而 joining two halves of an argument',
    example: '这不是能力问题，而是态度问题',
  },
  { level: 6, point: '不外乎 for it being nothing more than', example: '他的理由不外乎时间和金钱' },
  {
    level: 6,
    point: '大可不必 for it not being worth the trouble',
    example: '你大可不必为这点小事生气',
  },
  { level: 6, point: '且不说 for setting one thing aside', example: '且不说费用，光是时间就不够' },
  { level: 6, point: '唯恐 for the fear driving the action', example: '他小心翼翼，唯恐出错' },
  { level: 6, point: '凡是…都… for every case without exception', example: '凡是参加的人都要签名' },
  { level: 6, point: '在于 for where the heart of it lies', example: '问题的关键在于沟通' },
  { level: 6, point: '不亚于 for being no less than', example: '这项工作的难度不亚于上一次' },
];

/**
 * A sample of the points available at these levels, in a random order.
 *
 * Asking for more sentences than there are points is normal at one level, so the list repeats
 * once it has been through: every point comes up before any comes up twice.
 */
export function pickGrammarPoints(levels: number[], count: number): GrammarPoint[] {
  const available = GRAMMAR_POINTS.filter((point) => levels.includes(point.level));
  if (available.length === 0) {
    return [];
  }
  const picked: GrammarPoint[] = [];
  while (picked.length < count) {
    const shuffled = [...available];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    picked.push(...shuffled.slice(0, count - picked.length));
  }
  return picked;
}
