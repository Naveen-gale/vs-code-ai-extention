class PromptBuilder {
  static buildFIMPrompt({ prefix, suffix }) {
    return '<PRE> ' + prefix + ' <SUF> ' + suffix + ' <MID>';
  }
}

module.exports = { PromptBuilder };
