import { PodcastCategory } from '../types/podcast';

export const PODCAST_CATEGORIES: PodcastCategory[] = [
  {
    id: 'tarixiy',
    nameUz: 'Tarixiy & Allomalar',
    nameRu: 'Исторические и мыслители',
    taglineUz: 'Buyuk allomalar, qadimiy sivilizatsiyalar va o\'zbek xalqi tarixi',
    iconName: 'Landmark',
    badgeUz: 'Tarix',
    colorTheme: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/30',
      accent: 'from-amber-600 to-yellow-600',
    },
    suggestedVoice: 'Charon',
    suggestedTimbre: 'Iliq va salobatli chuqur bariton, vazmin intonatsiya',
    suggestedTempo: 'Vazmin (0.9x)',
    suggestedStyle: 'Hujjatli & Epik hikoyanavis',
    ambientSound: 'dutor-acoustic',
    topics: [
      {
        id: 'amir-temur',
        titleUz: 'Amir Temur va Samarqand: Qanday qilib jahon markaziga aylandi?',
        titleRu: 'Амир Темур и Самарканд: Как он стал центром мира?',
        descriptionUz: 'Amir Temurning me\'morchilik mo\'jizalari, Registon va jahon ilm-fani rivojidagi o\'rni haqida qiziqarli podkast.',
        sampleScriptUz: `[KIRISH]
Assalomu alaykum, qadrli podkast tinglovchilari! "Tarix Zarvaraqlari" podkastining navbatdagi soniga xush kelibsiz. <breath> Bugun biz siz bilan vaqt mashinasiga o'tirib, XIV asrga — moviy gumbazlar shahri, yer yuzining sayqali bo'lmish Samarqandga sayohat qilamiz.

[ASOSIY QISM]
Tasavvur qiling, buyuk sarkarda Amir Temur har bir zafardan so'ng eng mohir ustalar, olimlar va me'morlarni o'z poytaxtiga chorlagan. U bir so'zni bot-bot takrorlagan: "Bizning qudratimizni bilmoqchi bo'lsangiz, biz qurdirgan imoratlarga boqing!" |ha| Haqiqatan ham, Go'ri Amir, Bibixonim masjidi shunchaki binolar emas — ular muhandislik cho'qqisi edi.

[KULMINATSIYA]
Bilasizmi, Temurning eng katta merosi nima bo'lgan? Na shon-shuhrat, na zafarlar. Balki o'g'illari va nabiralariga qoldirgan ilm muhiti! Aynan shu muhitdan keyinchalik Mirzo Ulug'bek, Alisher Navoiy kabi daho siymolar yetishib chiqdi.

[XULOSA]
<breath> Aziz do'stlar, o'z tarixingizni bilish — kelajakka mustahkam poydevor qurishdir. Siz Amir Temur saltanatining qaysi siri haqida ko'proq bilishni istaysiz? Izohlarda o'z fikringizni qoldiring va keyingi qismlarni o'tkazib yubormang!`,
      },
      {
        id: 'ipak-yoli',
        titleUz: 'Buyuk Ipak Yo\'li: Buxoro va Xiva karvonlarining sirlari',
        titleRu: 'Великий Шелковый путь: Тайны караванов Бухары и Хивы',
        descriptionUz: 'Ming yillar davomida dunyo savdosi va madaniyatini bog\'lagan karvon yo\'llari haqida hikoya.',
        sampleScriptUz: `[KIRISH]
Sokin sahro kechasi, tuya qo'ng'iroqlarining mayin sadosi va minglab chaqirimlik xavfli yo'l... <breath> Assalomu alaykum, aziz podkasterlar! Bugungi mavzuimiz — Buyuk Ipak Yo'lining yuragi bo'lgan qadimiy Buxoro va Xiva karvonsaroylari haqida.

[ASOSIY QISM]
Savdogarlar Xitoydan ipak, Hindistondan ziravorlar, Samarqanddan esa dunyoga mashhur qog'oz olib o'tishgan. Karvonsaroylar faqat dam olish maskani emas, balki qizg'in bahslar, turli tillar va yangi ixtirolar almashiladigan markaz edi.

[XULOSA]
Bu boy meros bugun ham qonimizda yashamoqda. Biz bilan birga qoling, navbatdagi sarguzashtlar oldinda!`,
      },
    ],
  },
  {
    id: 'komedik',
    nameUz: 'Komedik & Hayotiy Hazillar',
    nameRu: 'Комедийные и жизненные истории',
    taglineUz: 'Kulgili vaziyatlar, to\'ylar, kundalik hayot va o\'zbekcha yumor',
    iconName: 'Laugh',
    badgeUz: 'Komedik',
    colorTheme: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/30',
      accent: 'from-emerald-600 to-teal-600',
    },
    suggestedVoice: 'Puck',
    suggestedTimbre: 'Yorqin, quvnoq va jonli tenor, samimiy kulgi bilan',
    suggestedTempo: 'Jonli (1.15x)',
    suggestedStyle: 'Quvnoq & Hazilomuz suhbat',
    ambientSound: 'comedy-jingle',
    topics: [
      {
        id: 'ozbek-toylari',
        titleUz: 'O\'zbek to\'ylari: 500 kishi, 3 xil sarpo va adashib kelgan mehmonlar',
        titleRu: 'Узбекские свадьбы: 500 гостей, приданое и незваные гости',
        descriptionUz: 'To\'ylarimizdagi eng kulgili, hayotiy va barchaga tanish voqealar haqida yengil podkast.',
        sampleScriptUz: `[KIRISH]
Hammaga salom! <laugh> "Kulgili Kundalik" podkastiga xush kelibsiz! Bugun barchamizning eng sevimli, ba\'zida esa bosh og'rig'iga aylanadigan mavzu — ha, to'g'ri topdingiz, o'zbek to'ylari haqida gaplashamiz! <breath>

[ASOSIY QISM]
Tasavvur qiling, to'yga ro'yxat tuzayotganda otangiz aytadi: "Bo'ldi, faqat eng yaqinlar keladi, ko'pi bilan 80 kishi". Ertasi kuni ro'yxatni qarasangiz — 480 ta odam! <laugh> "Bu kim dadajon?" desangiz, "Bu mening 1985-yilda armiyada birga bo'lgan do'stimning xolasining qudasi" deydilar! |ha| Bunisi ham mayli, to'yxonaga kirsangiz, sizni umringizda ko'rmagan amakilar quchoqlab, "Bo'yingdan aylanay, katta yigit bo'lib qolibsan!" deb ko'ziga yosh oladi.

[KULMINATSIYA]
Eng dahshati — to'yning ertasi kuni boshlanadi. Sovg'aga berilgan 12 ta bir xil choynak va 6 ta gilamni qayta saralash jarayoni! <laugh> Onangiz ularni keyingi to'yga berish uchun maxsus shkafga yashirib qo'yadilar.

[XULOSA]
Lekin qanchalik kulgili bo'lmasin, to'ylarimiz — mehr-oqibatimiz, xalqimizning xursandchiligi! Sizning to'yingizda yoki do'stingizning to'yida qanday qiziq voqea bo'lgan? Izohda yozib qoldiring, eng qiziqini keyingi sonda o'qib beraman! Xayr, doimo kulib yuring!`,
      },
      {
        id: 'toshkent-metrosi',
        titleUz: 'Metro sarguzashtlari: Eshiklar yopiladi, keyingi bekat — Hayot!',
        titleRu: 'Приключения в метро: Осторожно, двери закрываются!',
        descriptionUz: 'Toshkent metrosidagi qiziq tiplar, eshitiladigan kulgili suhbatlar va hayotiy hazillar.',
        sampleScriptUz: `[KIRISH]
Salom do'stlar! Har kuni ertalab soat sakkizda metroga tushganmisiz? <laugh> Bu shunchaki transport emas, bu o'ziga xos sirk va psixologik laboratoriya!

[ASOSIY QISM]
Vagonda hamma bor: bir burchakda qulog'iga quloqchin taqib konsert berayotgan yigit, o'rtada esa "Iltimos, sal oldinroq yuringlar, orqada joy bor!" deb qichqirayotgan amaki. Eng qizig'i — telefonda gaplashayotganlar: "Ha, falonchi, men uydan chiqdim, hozir yetib boraman" deb vagon guvillagan ovozda gapiradi.

[XULOSA]
Xullas, metroda zerikmaysiz. Hayotingiz quvnoq lahzalarga to'la bo'lsin!`,
      },
    ],
  },
  {
    id: 'ilm-fan',
    nameUz: 'Ilm-fan & Sun\'iy Intellekt',
    nameRu: 'Наука и Искусственный интеллект',
    taglineUz: 'Gemini 3.8, koinot sirlari, kelajak texnologiyalari va startaplar',
    iconName: 'Cpu',
    badgeUz: 'IT & Fan',
    colorTheme: {
      bg: 'bg-blue-500/10',
      text: 'text-blue-400',
      border: 'border-blue-500/30',
      accent: 'from-blue-600 to-indigo-600',
    },
    suggestedVoice: 'Zephyr',
    suggestedTimbre: 'Aniq, intellektual va ravshan diksiya, zamonaviy ritm',
    suggestedTempo: 'Standart (1.0x)',
    suggestedStyle: 'Ma\'rifiy & Ekspert suhbati',
    ambientSound: 'tech-ambient',
    topics: [
      {
        id: 'gemini-ozbek',
        titleUz: 'Gemini 3.8 va O\'zbek tili: Sun\'iy intellekt qanday qilib ona tilimizda gapirmoqda?',
        titleRu: 'Gemini 3.8 и узбекский язык: Как ИИ заговорил на нашем языке?',
        descriptionUz: 'Ovoz sintezi, Gemini 3.8 TTS Live imkoniyatlari va sun\'iy intellektning o\'zbek tilidagi inqilobi.',
        sampleScriptUz: `[KIRISH]
Salom, texnologiya ixlosmandlari! "Kelajak Kodlari" podkasti bilan birgasiz. <breath> Bugun biz dunyo bo'ylab texnologik olamni larzaga solayotgan Gemini 3.8 va uning tabiiy ovoz sintezi imkoniyatlarini tahlil qilamiz.

[ASOSIY QISM]
Yaqin-yaqingacha kompyuter ovozi o'zbek tilida juda mexanik, jonsiz eshitilar edi. <breath> Ammo Gemini 3.8 TTS Live modeli bilan bu chegara yo'qoldi! Endi sun'iy intellekt o'zbekcha so'zlarning urg'usini, his-tuyg'ularini, nafas olishni va hatto o'ziga xos intonatsiyani his qilib gapira oladi. |ha| Bu nafaqat podkasterlar, balki audio-kitoblar, ta'lim va ko'rish imkoniyati cheklangan insonlar uchun ulkan imkoniyatdir.

[KULMINATSIYA]
Eng qizig'i nima bilasizmi? Hozir siz eshitayotgan mana shu podkast ham aynan Gemini 3.8 TTS orqali sintez qilingan! Bir o'ylab ko'ring, kelajak allaqachon eshigimizni qoqqan.

[XULOSA]
Siz sun'iy intellektning qaysi yo'nalishda rivojlanishini kutmoqdasiz? O'z ovozingizni AI orqali yaratish sizga qanday tuyuladi? Bizga obuna bo'ling, ilm va texnologiya sirlarini birgalikda o'rganamiz!`,
      },
    ],
  },
  {
    id: 'ruhiyat',
    nameUz: 'Ruhiyat & Motivatsiya',
    nameRu: 'Психология и мотивация',
    taglineUz: 'Shaxsiy rivojlanish, ertalabki odatlar, qat\'iyat va stressdan xalos bo\'lish',
    iconName: 'HeartHandshake',
    badgeUz: 'Rivojlanish',
    colorTheme: {
      bg: 'bg-rose-500/10',
      text: 'text-rose-400',
      border: 'border-rose-500/30',
      accent: 'from-rose-600 to-pink-600',
    },
    suggestedVoice: 'Kore',
    suggestedTimbre: 'Mayin, tinchlantiruvchi va chuqur samimiy ayol yoki erkak ovozi',
    suggestedTempo: 'Xotirjam (0.85x)',
    suggestedStyle: 'Samimiy & Ilhomlantiruvchi',
    ambientSound: 'calm-piano',
    topics: [
      {
        id: 'ertalabki-odatlar',
        titleUz: 'Erta tonggi 1 soat: Hayotingizni o\'zgartiruvchi 5 ta oltin qoida',
        titleRu: 'Утренний час: 5 золотых правил, меняющих жизнь',
        descriptionUz: 'Kuningizni qanday boshlasangiz, butun umringiz shunday shakllanadi. Ichki uyg\'unlik va samaradorlik sirlari.',
        sampleScriptUz: `[KIRISH]
Salom, qalb do'stim. <breath> Chuqur nafas oling. O'zingizga bir lahza ajrating. "Yorug' Fikrlar" podkastining yangi soniga xush kelibsiz.

[ASOSIY QISM]
Ko'pchiligimiz tongni qanday boshlaymiz? Budilnik jiringlaydi, shoshib telefonni olamiz, ijtimoiy tarmoqlardagi shovqin-suronga sho'ng'iymiz. Natijada nima bo'ladi? Kun boshlanmasdan turib charchoq hissi paydo bo'ladi. <breath> Agar siz tonggi ilk 60 daqiqani faqat o'zingizga — sukunatga, bir piyola iliq suvga, minnatdorchilikka va o'z maqsadingizni eslashga bag'ishlasangiz, butun kuningiz boshqacha rang oladi.

[KULMINATSIYA]
Esingizda bo'lsin: siz tashqi dunyodagi hodisalarni nazorat qila olmaysiz, lekin ularga bo'lgan munosabatingizni har soniya o'zingiz tanlaysiz. Siz bugun o'zingizga qanday munosabatda bo'lasiz?

[XULOSA]
O'zingizga ishoning. Har bir tong — yangi boshlanish, yangi imkoniyatdir. Bugungi kuningiz xayrli va unumli o'tsin!`,
      },
    ],
  },
  {
    id: 'sirli-detektiv',
    nameUz: 'Sirli & Kriminal Detektiv',
    nameRu: 'Тайны и Детективы',
    taglineUz: 'Jumboqlar, qadimiy xazinalar, yo\'qolgan shaharlar va sirli tergovlar',
    iconName: 'Search',
    badgeUz: 'Detektiv',
    colorTheme: {
      bg: 'bg-purple-500/10',
      text: 'text-purple-400',
      border: 'border-purple-500/30',
      accent: 'from-purple-600 to-indigo-700',
    },
    suggestedVoice: 'Fenrir',
    suggestedTimbre: 'Sirli, qalin, past va vazmin bariton, kutilmagan pauzalar bilan',
    suggestedTempo: 'Vazmin (0.9x)',
    suggestedStyle: 'Dramatik & Qorong\'u sirli hikoya',
    ambientSound: 'cinematic-dark',
    topics: [
      {
        id: 'orol-siri',
        titleUz: 'Orol dengizi tubidagi sirli shahar: Qadimiy Kerderi mo\'jizasi',
        titleRu: 'Тайна дна Аральского моря: Загадочный город Кердери',
        descriptionUz: 'Suv chekingach Orol dengizi tubidan topilgan XIV asrga oid qadimiy maqbara va sirli shahar xarobalari haqida tergov.',
        sampleScriptUz: `[KIRISH]
2001-yil. Orol dengizining qurigan tubi. Shamol ko'targan tuz va qum bo'roni ostida arxeologlar g'aroyib narsaga duch kelishdi... <breath> Suv ostida ming yildan beri yashirinib yotgan butun boshli shahar xarobalari! "Sirli Tergov" podkastiga xush kelibsiz.

[ASOSIY QISM]
Bu qadimiy Kerderi shahri edi. U yerda pishiq g'ishtdan qurilgan maqbaralar, kulolchilik ustaxonalari va tangalar topildi. Savol tug'iladi: Orol dengizi o'rnida qachonlardir gullab-yashnagan hayot bo'lganmi? Qanday qilib u suv ostida qolgan va yana qayta yuzaga chiqdi?

[KULMINATSIYA]
Tarixchilar hanuzgacha bu jumboq ustida bosh qotirmoqdalar. Tabiat qonunlari insoniyatga qanday sirli saboqlarni bermoqda?

[XULOSA]
Biz tabiatning barcha sirlarini bilamiz deb o'ylaymiz, ammo sahro va dengiz tubida kashf qilinmagan yuzlab jumboqlar yotibdi. Podkastimizga a'zo bo'ling, sirlarni birga ochamiz!`,
      },
    ],
  },
  {
    id: 'biznes-boshqaruv',
    nameUz: 'Biznes & Muvaffaqiyat',
    nameRu: 'Бизнес и Успех',
    taglineUz: 'Startaplar, investitsiyalar, marketing va O\'zbekistondagi tadbirkorlik',
    iconName: 'TrendingUp',
    badgeUz: 'Biznes',
    colorTheme: {
      bg: 'bg-cyan-500/10',
      text: 'text-cyan-400',
      border: 'border-cyan-500/30',
      accent: 'from-cyan-600 to-blue-600',
    },
    suggestedVoice: 'Charon',
    suggestedTimbre: 'Ishonchli, qat\'iy, dinamik va biznesga xos professional ohang',
    suggestedTempo: 'Dinamik (1.05x)',
    suggestedStyle: 'Biznes & Amaliy tavsiyalar',
    ambientSound: 'business-uplifting',
    topics: [
      {
        id: 'startap-strategiya',
        titleUz: 'Noldan biznes boshlash: O\'zbekiston bozorida 2026-yilgi 3 ta asosiy trend',
        titleRu: 'Бизнес с нуля: 3 главных тренда рынка Узбекистана в 2026 году',
        descriptionUz: 'Tadbirkorlikda tavakkalchilikni kamaytirish, e-commerce va sun\'iy intellektni biznesga tatbiq etish.',
        sampleScriptUz: `[KIRISH]
Salom, bo'lajak liderlar va tadbirkorlar! "Biznes Puls" podkasti navbatdagi sonida O'zbekiston bozoridagi eng istiqbolli imkoniyatlarni ko'rib chiqadi.

[ASOSIY QISM]
Ko'pchilik "Menda g'oya bor, lekin pulim yo'q" deydi. Aslida esa biznesda g'oyaning o'zi hech narsa emas — ijro, ya'ni execution hal qiladi! Bugun O'zbekistonda mahalliy ishlab chiqarish, sun'iy intellekt asosidagi xizmatlar va tezkor yetkazib berish tizimlari portlash darajasida o'smoqda.

[XULOSA]
Katta natijalarga erishish uchun birinchi qadamni bugun tashlang. Muvaffaqiyat harakat qilganlarga kulib boqadi!`,
      },
    ],
  },
  {
    id: 'erkin',
    nameUz: 'Erkin Mavzu & Eksklyuziv',
    nameRu: 'Свободная тема и эксклюзив',
    taglineUz: 'O\'zingiz xohlagan mavzuni yozing yoki sun\'iy intellektga yozdiring',
    iconName: 'Sparkles',
    badgeUz: 'Maxsus',
    colorTheme: {
      bg: 'bg-violet-500/10',
      text: 'text-violet-400',
      border: 'border-violet-500/30',
      accent: 'from-violet-600 to-purple-600',
    },
    suggestedVoice: 'Puck',
    suggestedTimbre: 'Universal, moslashuvchan va jozibador ovoz',
    suggestedTempo: 'Standart (1.0x)',
    suggestedStyle: 'Jonli suhbat',
    ambientSound: 'lofi-beats',
    topics: [
      {
        id: 'erkin-suhbat',
        titleUz: 'O\'zbekistonning go\'zal tabiati: Chimyon va Zomin sarguzashti',
        titleRu: 'Красота природы: Путешествие в Чимган и Заамин',
        descriptionUz: 'Tog\' havosi, shifobaxsh archazorlar va sayohat taassurotlari haqida erkin podkast.',
        sampleScriptUz: `[KIRISH]
Assalomu alaykum, aziz sayohatchilar! Bugun siz bilan birga shahar changi va shovqinidan uzoqlashib, musaffo tog' bag'riga yo'l olamiz.

[ASOSIY QISM]
Zominning qalin archazorlari, sharqirab oqayotgan soylari va Chimyon cho'qqilaridagi qorli manzara har qanday charchoqni bir zumda yuvib yuboradi. O'zbekiston tabiati naqadar betakror ekaniga har safar hayratlanasan kishi.

[XULOSA]
Taqvimingizga dam olish kunini belgilang va tabiat bilan yuzma-yuz bo'ling. Podkastimiz sizga yoqqan bo'lsa, do'stlaringizga ulashing!`,
      },
    ],
  },
];
