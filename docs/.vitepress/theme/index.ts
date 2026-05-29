import DefaultTheme from "vitepress/theme";
import WorkflowSimulator from "./components/WorkflowSimulator.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("WorkflowSimulator", WorkflowSimulator);
  }
};
