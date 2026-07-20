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

    let buttons = getKudosBtnsWithtin();
    let skipped = 0;
    let clicked = 0;

    buttons.forEach(svg=>{
        let button = svg.closest("button");
        if (!button){
            return console.error("Failed to find button for ",svg);
        }

        // Skip buttons that are just "view kudos" on your own activities.
        // On your own activities, the button has title="View all kudos" (you can't kudo yourself).
        // On other people's activities you haven't kudoed, the title is "Give kudos" or empty.
        const title = (button.getAttribute("title") || "").toLowerCase();
        if (title.includes("view all kudos")) {
            skipped++;
            console.log("KudoAll: skipping own activity button:", button.getAttribute("title"));
            return;
        }

        button.click();
        clicked++;
    })

    console.log(`KudoAll: clicked ${clicked}, skipped ${skipped}`);
}
