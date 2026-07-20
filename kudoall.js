console.log("Adding KudoAll");

let kudoAllItem = document.querySelector("#container-nav > ul.global-nav.nav-group");

if (!kudoAllItem) {
    console.log("KudoAll: Not on the dashboard page, skipping.");
} else {

let li          = document.createElement("li");
li.classList.add("nav-item");
let a           = document.createElement("a");
a.classList.add("nav-link");
a.addEventListener("click", kudoAllFn);//    = `<a class="nav-link" onclick="kudoAllFn()">Kudo All</a>`;
a.style.display       = "flex";
a.style.flexDirection = "row";
a.style.alignItems    = "center";
a.innerHTML           = `<img src="${chrome?.runtime?.getURL('images/icon-48.png')}" alt="👍" style="display: inline !important;
  vertical-align: middle !important; max-height:16px; max-width:16px;"> <span style="margin-left:5px;">Kudo All</span>`;
li.append(a);
kudoAllItem.append(li);

} // end guard

function getKudosBtnsWithtin(holder=document){

    const kudosBtnsNotClicked = "button[data-testid='kudos_button'] > svg[data-testid='unfilled_kudos']";
    return [...holder.querySelectorAll( kudosBtnsNotClicked )];
}

function kudoAllFn(e){
    e.preventDefault();

    // Get the current athlete ID to exclude own activities
    const currentAthleteLink = document.querySelector('ul.user-nav a[href*="/athletes/"]');
    const currentAthleteHref = currentAthleteLink?.getAttribute('href') || '';

    let buttons = getKudosBtnsWithtin();

    buttons.forEach(svg=>{
        let button = svg.closest("button");
        if (!button){
            return console.error("Failed to find button for ",svg);
        }

        // Skip if this button is within an activity owned by the current athlete
        const card = button.closest('[class*="entry"]') || button.closest('article') || button.closest('div[data-testid]');
        if (card && currentAthleteHref) {
            const ownerLink = card.querySelector(`a[href="${currentAthleteHref}"][class*="entry-owner"], a.entry-owner[href="${currentAthleteHref}"]`);
            if (ownerLink) return;
        }

        button.click();
    })

}
