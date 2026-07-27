/**
 * GE Beauty — retail team WhatsApp-sales discovery survey.
 * Paste into https://script.google.com (new project), Run > createOutreachForm, authorize,
 * then open View > Logs (Execution log) for the 3 URLs (edit / share / responses sheet).
 * Builds the Form + a linked responses Spreadsheet in one run. Portuguese, rep-facing.
 */
function createOutreachForm() {
  var form = FormApp.create('GE Beauty — Vendas por WhatsApp')
    .setDescription(
      'Oi! 💛 Queremos montar uma ferramenta que te ajude a vender mais pelo WhatsApp — ' +
      'e ninguém entende disso melhor que você. São 7 perguntas rápidas (uns 5 minutos). ' +
      'Não existe resposta certa ou errada: queremos aprender com a sua experiência de verdade. Obrigada!')
    .setCollectEmail(false)
    .setProgressBar(true)
    .setAllowResponseEdits(true);

  // --- slicers (quick multiple-choice, so we can compare across lojas/tempo de casa) ---
  form.addMultipleChoiceItem()
    .setTitle('Qual a sua loja / base?')
    .setChoiceValues(['RioSul', 'Shops Jardins', 'Shopping Recife', 'Outra'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Há quanto tempo você vende na GE Beauty?')
    .setChoiceValues(['Menos de 6 meses', '6 a 12 meses', '1 a 2 anos', 'Mais de 2 anos'])
    .setRequired(false);

  // --- the 7 discovery questions (open text) ---
  var qs = [
    'Quando você vai vender pelo WhatsApp, como você decide quem chamar primeiro?',
    'Antes de mandar a mensagem, o que você olha sobre o cliente? (o que já comprou, há quanto tempo, de onde é...)',
    'Me conta uma venda boa recente pelo WhatsApp: o que você falou e o que fez dar certo?',
    'O que faz o cliente dizer "sim"? E qual costuma ser o motivo do "não"?',
    'Se você pudesse saber UMA única coisa sobre cada cliente antes de chamar, o que seria?',
    'Qual a parte mais chata ou demorada de vender pelo WhatsApp hoje?',
    'Depois de quanto tempo da última compra você costuma chamar o cliente? E se ele não responde, quando você chama de novo?'
  ];
  qs.forEach(function (q, i) {
    form.addParagraphTextItem().setTitle((i + 1) + '. ' + q).setRequired(true);
  });

  // --- optional name ---
  form.addTextItem().setTitle('Seu nome (opcional)').setRequired(false);

  // --- linked responses spreadsheet ---
  var ss = SpreadsheetApp.create('GE Beauty — Vendas por WhatsApp (respostas)');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  Logger.log('FORM (editar):        ' + form.getEditUrl());
  Logger.log('FORM (compartilhar):  ' + form.getPublishedUrl());
  Logger.log('RESPOSTAS (planilha): ' + ss.getUrl());
}
