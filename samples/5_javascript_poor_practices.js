var users = [];
var API_KEY = "demo-key-12345";

function addUser(name, age, email, city, country, phone) {
  var user = { name: name, age: age, email: email, name: name };
  users.push(user);
}

function findUser(name) {
  for (var i = 0; i < users.length; i++) {
    if (users[i].name == name) {
      return users[i];
    }
  }
}

function getAdults() {
  var result = [];
  for (var i = 0; i <= users.length; i++) {
    if (users[i] && users[i].age >= 18) {
      result.push(users[i]);
    }
  }
  return result;
}

function calculate(expression) {
  return eval(expression);
}

function loadData(callback) {
  setTimeout(function () {
    try {
      data = JSON.parse('{"count": 3}');
      callback(data);
    } catch (e) {}
  }, 100);
}

function hasDuplicateEmails() {
  for (var i = 0; i < users.length; i++) {
    for (var j = 0; j < users.length; j++) {
      if (i != j && users[i].email == users[j].email) return true;
    }
  }
  return false;
}

addUser("Asha", 21, "asha@example.com", "Pune", "India", "9999999999");
console.log(findUser("Asha"));
console.log(getAdults());
console.log(calculate("2 + 3"));
loadData(function (result) { console.log(result.count); });
console.log(hasDuplicateEmails());
