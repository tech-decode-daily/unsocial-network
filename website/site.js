const tablist = document.querySelector('[role="tablist"]');
const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));

function selectSystem(index, focus = false) {
  tabs.forEach((tab, i) => {
    const selected = i === index;
    const panel = document.getElementById(tab.getAttribute("aria-controls"));
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.hidden = !selected;
    panel.classList.toggle("enter", selected);
  });
  tablist.style.setProperty("--active", index);
  if (focus) tabs[index].focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectSystem(index));
  tab.addEventListener("keydown", (event) => {
    const last = tabs.length - 1;
    const targets = {
      ArrowLeft: (index + last) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: last,
    };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    selectSystem(targets[event.key], true);
  });
});

const platform = navigator.userAgentData?.platform ?? navigator.platform;
selectSystem(/mac/i.test(platform) ? 1 : /linux/i.test(platform) && !/Android/i.test(navigator.userAgent) ? 2 : 0);
tablist.hidden = false;
