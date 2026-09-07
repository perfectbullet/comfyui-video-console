// task store
import { defineStore } from "pinia";

export const useTaskStore = defineStore("task", {
  state: () => ({
    rerunTask: null,
  }),
  actions: {
    setRerunTask(task: any) {
      this.rerunTask = task;
    },
  },
});
