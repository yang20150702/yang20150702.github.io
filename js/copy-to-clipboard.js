document.addEventListener("DOMContentLoaded", function() {
    const codeBlocks = document.querySelectorAll("pre");

    codeBlocks.forEach((block) => {
        // 创建复制按钮
        const button = document.createElement("button");
        button.className = "copy-button";
        button.textContent = "Copy";
        block.appendChild(button);

        // 复制功能
        button.addEventListener("click", () => {
            const code = block.querySelector("code").innerText;

            navigator.clipboard.writeText(code).then(() => {
                button.textContent = "Copied!";
                setTimeout(() => {
                    button.textContent = "Copy";
                }, 2000);
            });
        });
    });
});
