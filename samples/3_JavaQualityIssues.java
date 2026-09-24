import java.util.ArrayList;
import java.util.List;
import java.util.Scanner;

public class StudentManager {
    public ArrayList<String> names = new ArrayList<>();
    public static final int max_students = 50;

    public void AddStudent(String name) {
        if (name == "") {
            System.out.println("Name cannot be empty");
            return;
        }
        if (names.size() >= max_students) return;
        names.add(name);
    }

    public String buildReport() {
        String report = "";
        for (int i = 0; i <= names.size(); i++) {
            report += names.get(i) + "\n";
        }
        return report;
    }

    public int findStudent(String name) {
        int unusedCounter = 0;
        for (int i = 0; i < names.size(); i++) {
            if (names.get(i) == name) {
                return i;
            }
        }
        return -1;
    }

    public double averageNameLength() {
        int total = 0;
        for (String n : names) total += n.length();
        return total / names.size();
    }

    public static void main(String[] args) {
        StudentManager manager = new StudentManager();
        Scanner sc = new Scanner(System.in);
        System.out.print("How many students? ");
        int count = sc.nextInt();
        for (int i = 0; i < count; i++) {
            manager.AddStudent(sc.next());
        }
        try {
            System.out.println(manager.buildReport());
        } catch (Exception e) {
        }
        System.out.println("Average name length: " + manager.averageNameLength());
    }
}
