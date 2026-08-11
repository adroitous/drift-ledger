export function callExtensionApi(target, methodName, ...args) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      const lastError = globalThis.chrome?.runtime?.lastError;
      if (lastError) {
        reject(new Error(lastError.message || String(lastError)));
      } else {
        resolve(value);
      }
    };

    try {
      const result = target[methodName](...args, finish);
      if (result && typeof result.then === "function") {
        result.then(finish, (error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
      }
    } catch (error) {
      if (!settled) {
        settled = true;
        reject(error);
      }
    }
  });
}

export function sendRuntimeMessage(message) {
  return callExtensionApi(chrome.runtime, "sendMessage", message);
}
