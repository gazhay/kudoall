console.log("Adding KudoAll");

let navbar = document.querySelector(`.global-nav`);

let kudoAllItem = document.createElement("ul");
kudoAllItem.classList.add("nav-group");
let li          = document.createElement("li");
li.classList.add("nav-item");
let a           = document.createElement("a");
a.classList.add("nav-link");
a.addEventListener("click", kudoAllFn);//    = `<a class="nav-link" onclick="kudoAllFn()">Kudo All</a>`;
a.style.display       = "flex";
a.style.flexDirection = "row";
a.style.alignItems    = "center";
a.innerHTML           = `<img src="${chrome.runtime.getURL('images/icon-48.png')}" alt="👍" style="display: inline !important;
  vertical-align: middle !important; max-height:16px; max-width:16px;"> <span style="margin-left:5px;">Kudo All</span>`;
li.append(a);
kudoAllItem.append(li);

navbar.parentNode.insertBefore(kudoAllItem, navbar.nextSibling);

function getKudosBtnsWithtin(holder=document){

    const kudosBtnsNotClicked = "button[data-testid='kudos_button'] > svg[data-testid='unfilled_kudos']";
    return [...holder.querySelectorAll( kudosBtnsNotClicked )];
}

function kudoAllFn(e){
    e.preventDefault();

    let buttons = getKudosBtnsWithtin();

    buttons.forEach(svg=>{
        let button = svg.closest("button");
        if (!button){
            return console.error("Failed to find button for ",svg);
        }
        button.click();
    })

}
