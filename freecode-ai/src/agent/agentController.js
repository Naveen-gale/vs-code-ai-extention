class AgentController {
  constructor(planner, tools) {
    this.planner = planner;
    this.tools = tools;
  }

  async runTask(userGoal) {
    // Orchestrate task execution
  }
}

module.exports = { AgentController };
